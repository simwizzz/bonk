/* REA local adapter for the observed PokéBonk 0.7.8 client contract.
 * No fetch, server credentials, cloud synchronization, or original bundle import.
 * Rules are injected from the retained client by the derived offline entry point.
 */
export function createReaLocalBackend(options = {}) {
  const rules = options.rules ?? globalThis.REA_POKEBONK_RULES;
  if (!rules?.createProfile || !rules?.normalizeProfile) {
    throw new Error('REA 本地适配器缺少 0.7.8 客户端规则绑定。');
  }
  const storage = options.storage ?? globalThis.localStorage;
  const key = options.storageKey ?? 'rea.pokebonk.0.7.8.state.v1';
  if (!key.startsWith('rea.')) throw new Error('REA 存储键必须使用 rea. 命名空间。');
  if (!storage?.getItem || !storage?.setItem) throw new Error('浏览器本地存储不可用，无法保存离线进度。');
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => {
    if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 0x100000000);
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const localReason = 'REA 本地离线记录：进度保存在此浏览器，未连接官方服务器，不参与云端排行。通用战斗星尘公式尚未恢复。';
  const fail = (message, status = 409) => Object.assign(new Error(message), { status, local: true });
  const disabled = () => { throw fail('REA 离线还原版：账号、云端排行和社交功能未启用；进度仅保存在此浏览器。', 501); };
  const dex = () => typeof options.dex === 'function' ? options.dex() : options.dex;
  const validSpecies = id => Number.isInteger(id) && id > 0 && (!dex()?.has || dex().has(id));
  const family = id => dex()?.family?.(id) ?? id;
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  const ids = values => Array.isArray(values) ? values.filter(validSpecies) : [];
  const unique = values => [...new Set(values)];
  const activeTickets = new Set();
  const pendingFinishes = new Map();
  const clean = value => JSON.parse(JSON.stringify(value), (k, v) => ['__proto__', 'prototype', 'constructor'].includes(k) ? undefined : v);
  const normalize = profile => rules.normalizeProfile(clone(profile));
  const read = () => {
    let raw;
    try { raw = storage.getItem(key); } catch { throw fail('无法读取浏览器本地存储；请允许此站点存储数据。', 507); }
    if (!raw) return null;
    let state;
    try { state = clean(JSON.parse(raw)); } catch { throw fail('REA 本地存档损坏，已保留原数据，未自动覆盖。', 422); }
    if (state?.schema !== 1 || !state.profile || !state.account?.id) throw fail('REA 本地存档格式不受支持，未自动覆盖。', 422);
    state.profile = normalize(state.profile);
    state.tickets ??= {};
    state.completed ??= {};
    state.checkpoints ??= {};
    return state;
  };
  const write = state => {
    try { storage.setItem(key, JSON.stringify(state)); } catch { throw fail('REA 本地保存失败，可能已超出浏览器存储容量；请先导出存档。', 507); }
  };
  const initialState = () => {
    const account = { id: `rea-local-${random().toString(36)}`, name: 'REA 本地访客', guest: true, local: true };
    return { schema: 1, account, sessionActive: true, profile: normalize(rules.createProfile(account.name)), tickets: {}, completed: {}, checkpoints: {}, live: null };
  };
  const stateFor = account => {
    const state = read();
    if (!state || !state.sessionActive || account?.id !== state.account.id) throw fail('本地访客会话已退出，请重新进入。', 401);
    return state;
  };
  const pendingIds = (account, state) => {
    const pending = new Set([...pendingFinishes].filter(([, item]) => item.account === account?.id).map(([id]) => id));
    if (state?.live?.ticket?.id) pending.add(state.live.ticket.id);
    return pending;
  };
  const tickTasks = profile => rules.refreshTasks?.(profile, now());
  const openBiomes = profile => {
    for (let index = 0; index < (rules.biomes?.length ?? 0); index++) {
      const biome = rules.biomes[index];
      if (!(biome.id in profile.biomes) && (index === 0 || (profile.biomes[rules.biomes[index - 1].id] ?? -1) >= 1)) profile.biomes[biome.id] = 0;
    }
  };
  const mutate = (account, operation, ...args) => {
    const state = stateFor(account);
    tickTasks(state.profile);
    if (typeof rules[operation] !== 'function') throw fail(`REA 本地规则未绑定：${operation}。`, 501);
    if (!rules[operation](state.profile, ...args)) throw fail('当前进度、材料或可用次数不足，未保存该操作。');
    write(state);
    return normalize(state.profile);
  };
  const prefs = ['settings', 'lastSpecies', 'lastBiome', 'avatar', 'frame', 'title', 'skins'];
  const add = (profile, name, value) => { profile.counters[name] = finite(profile.counters[name]) + finite(value); };
  const maximum = (profile, name, value) => { profile.counters[name] = Math.max(finite(profile.counters[name]), finite(value)); };
  const applyResult = (state, ticket, rawResult, rescued = false) => {
    const result = clean(rawResult);
    const cfg = state.tickets[ticket.id]?.config;
    if (!cfg) throw fail('此战斗凭据不属于本地存档。');
    for (const field of ['species', 'biome', 'tier', 'mode']) {
      if (result[field] !== cfg[field]) throw fail(`战斗结算与本地开始参数不一致：${field}。`);
    }
    if (!validSpecies(result.finalSpecies)) throw fail('战斗结束形态无效。', 422);
    for (const field of ['time', 'kills', 'damage', 'level', 'stage', 'bosses', 'alphas', 'reactions']) {
      if (finite(result[field], -1) < 0) throw fail(`战斗结算数值无效：${field}。`, 422);
    }
    const profile = state.profile;
    tickTasks(profile);
    const deltas = {};
    const caps = rules.counterCaps?.(result) ?? {};
    for (const [counter, value] of Object.entries(result.progress?.counters ?? {})) {
      // ib.report only emits the Me(result) keys. Never persist arbitrary supplied fields.
      if (!(counter in caps)) continue;
      deltas[counter] = Math.min(finite(value), finite(caps[counter]));
    }
    for (const [counter, value] of Object.entries(deltas)) {
      add(profile, counter, value);
      maximum(profile, `best_${counter}`, value);
    }
    for (const field of ['kills', 'damage', 'bosses', 'legendaries', 'alphas', 'reactions']) {
      add(profile, field, result[field]);
      maximum(profile, `best_${field}`, result[field]);
    }
    add(profile, 'runs', 1);
    add(profile, 'playtime', result.time);
    maximum(profile, 'maxTime', result.time);
    maximum(profile, 'maxLevel', result.level);
    add(profile, `kills_${result.biome}`, result.kills);
    add(profile, `boss_${result.biome}`, result.bosses);
    profile.played = unique([...profile.played, result.species]);
    profile.counters.speciesPlayed = profile.played.length;
    const endless = result.mode === 'endless';
    const won = !endless && !!result.victory && !rescued;
    if (endless) {
      maximum(profile, 'endlessTime', result.time);
      const previous = profile.endless[result.biome];
      if (!previous || result.time > previous.time || result.time === previous.time && result.kills > previous.kills) profile.endless[result.biome] = { time: result.time, kills: result.kills };
    }
    if (won) {
      add(profile, 'wins', 1);
      add(profile, `win_${result.biome}`, 1);
      profile.biomes[result.biome] = Math.max(profile.biomes[result.biome] ?? 0, Math.min(3, result.tier + 1));
    }
    openBiomes(profile);
    profile.counters.mapsWon = Object.values(profile.biomes).filter(tier => tier >= 1).length;
    for (const [rawId, amount] of Object.entries(result.progress?.research ?? {})) {
      const id = Number(rawId);
      if (!validSpecies(id)) continue;
      const root = family(id);
      const goal = dex()?.researchGoal?.(root);
      if (!Number.isFinite(goal)) continue;
      profile.research[root] = Math.min(goal, finite(profile.research[root]) + finite(amount));
    }
    profile.seen = unique([...profile.seen, ...ids(result.progress?.seen)]);
    profile.forms = unique([...profile.forms, ...ids(result.progress?.forms)]);
    const captured = [];
    for (const id of unique(ids(result.progress?.league))) {
      if (profile.league.includes(id) || !rules.leagueHas?.(id) || !rules.leagueReady?.(profile, id)) continue;
      profile.league.push(id);
      const root = family(id);
      profile.unlocked = unique([...profile.unlocked, root]);
      profile.captured[root] = now();
      add(profile, 'captures', 1);
      captured.push(id);
    }
    let stardust = 0;
    const shinyCaptures = ids(result.progress?.shinies);
    for (const id of shinyCaptures) {
      const first = !profile.shinies.includes(id);
      if (first) profile.shinies.push(id);
      profile.seen = unique([...profile.seen, id]);
      stardust += finite(first ? rules.shinyRewards?.first : rules.shinyRewards?.repeat);
      add(profile, 'shinies', 1);
    }
    // The server's general battle dust formula is absent from the static client.
    // Only rewards explicitly present in the retained client are credited here.
    profile.stardust += stardust;
    profile.totalStardust += stardust;
    const tasks = [];
    const metrics = { ...deltas, kills: result.kills, runKills: result.kills, runs: 1, playtime: result.time, time: result.time, level: result.level, stage: result.stage, wins: +won, bosses: result.bosses, legendaries: finite(result.legendaries), alphas: result.alphas, reactions: result.reactions, shinies: shinyCaptures.length };
    const perRun = new Set(['runKills', 'time', 'level', 'stage']);
    for (const period of ['daily', 'weekly']) {
      const taskState = profile[period];
      for (let slot = 0; slot < taskState.ids.length; slot++) {
        const task = rules.task?.(taskState.ids[slot]);
        if (!task) continue;
        const before = finite(taskState.prog[slot]);
        const value = finite(metrics[task.metric]);
        taskState.prog[slot] = Math.min(task.goal, perRun.has(task.metric) ? Math.max(before, value) : before + value);
        if (before < task.goal && taskState.prog[slot] >= task.goal) tasks.push({ id: task.id, period, slot });
      }
    }
    const record = { ...result, victory: won, id: ticket.id, date: now(), seed: ticket.seed, score: rules.score?.({ ...result, victory: won }) ?? 0, ranked: false, local: true };
    if (rescued) record.end = { ...record.end, how: 'rescued' };
    profile.runs.unshift(record);
    const index = `${result.biome}-${result.tier}`;
    if (!endless) {
      profile.kills[index] = Math.max(finite(profile.kills[index]), result.kills);
      if (won && (!profile.times[index] || result.time < profile.times[index].time)) profile.times[index] = { time: result.time, splits: clone(result.splits ?? []) };
      if (!profile.best[index] || record.score > profile.best[index].score) profile.best[index] = clone(record);
    }
    const response = { profile: normalize(profile), record, stardust, tasks, ranked: false, local: true, reason: localReason, weekPb: false, medal: null, rea: { settlement: 'local-observed-client-rules', generalBattleDust: 'unavailable', rescued, captured } };
    // Keep completed receipt for exactly-once settlement; retries return current profile.
    state.completed[ticket.id] = { record: clone(record), stardust, tasks, rea: response.rea };
    delete state.tickets[ticket.id];
    delete state.checkpoints[ticket.id];
    if (state.live?.ticket.id === ticket.id) state.live = null;
    return response;
  };
  const backend = {
    kind: 'local', clockSkew: 0, local: true, onSaved: null, onMaintenance: null, onInviteOnly: null, onBanned: null,
    season() {
      // Client scheduling rules are reused, but no server season standing is claimed.
      return { ...(rules.season?.(now()) ?? { n: 0, start: 0, end: 0, next: null }), name: 'REA 本地', live: false, message: '离线存档，无云端排名', local: true };
    },
    async status() { return { maintenance: { on: false }, bypass: false, registration: { inviteOnly: false }, season: backend.season(), local: true }; },
    async restore() { const state = read(); return state?.sessionActive ? clone(state.account) : null; },
    async guest() {
      const state = read() ?? initialState();
      state.sessionActive = true;
      tickTasks(state.profile);
      write(state);
      return clone(state.account);
    },
    guestSave() { return !!read()?.account; },
    async logout() { const state = read(); if (state) { state.sessionActive = false; write(state); } },
    async loadProfile(account) {
      const state = stateFor(account);
      if (state.live?.ticket?.id && !activeTickets.has(state.live.ticket.id) && !pendingFinishes.has(state.live.ticket.id) && state.tickets[state.live.ticket.id]) applyResult(state, state.live.ticket, state.live.result, true);
      tickTasks(state.profile);
      openBiomes(state.profile);
      write(state);
      return normalize(state.profile);
    },
    async savePrefs(account, profile) {
      const state = stateFor(account);
      for (const field of prefs) if (profile[field] !== undefined) state.profile[field] = clean(profile[field]);
      state.profile = normalize(state.profile);
      write(state);
    },
    async chooseStarter(account, id) {
      const state = stateFor(account);
      if (!(rules.starters ?? [1, 4, 7]).includes(id)) throw fail('请选择初始伙伴列表中的角色。', 422);
      if (state.profile.starter) {
        if (state.profile.starter === id) return normalize(state.profile);
        throw fail('已选择初始伙伴，其他伙伴须完成挑战后捕获。');
      }
      state.profile.starter = id;
      state.profile.lastSpecies = id;
      state.profile.league.push(id);
      state.profile.unlocked = unique([...state.profile.unlocked, family(id)]);
      state.profile.seen = unique([...state.profile.seen, id]);
      state.profile.captured[family(id)] = now();
      write(state);
      return normalize(state.profile);
    },
    async buyLab(account, id) { return mutate(account, 'buyLab', id); },
    async buyItem(account, id) { return mutate(account, 'buyItem', id); },
    async archiveItem(account, id, off) { return mutate(account, 'archiveItem', id, off); },
    async claimQuest(account, id) { return mutate(account, 'claimQuest', id); },
    async claimTask(account, period, slot) { return mutate(account, 'claimTask', period, slot, now()); },
    async rerollTask(account, period, slot) { return mutate(account, 'rerollTask', period, slot, now()); },
    async startRun(account, input) {
      const state = stateFor(account);
      const config = clean(input);
      config.mode ??= 'standard';
      config.tier ??= 0;
      if (!state.profile.league.includes(config.species) || !rules.leagueHas?.(config.species)) throw fail('该角色尚未加入本地联盟。');
      if (!rules.biomes?.some(biome => biome.id === config.biome) || rules.biomeEnabled && !rules.biomeEnabled(config.biome)) throw fail('此地图当前不可用。');
      if (!Number.isInteger(config.tier) || config.tier < 0 || config.tier > 2 || config.tier > (state.profile.biomes[config.biome] ?? -1)) throw fail('本地进度尚未解锁此地图难度。');
      if (!['standard', 'endless'].includes(config.mode)) throw fail('未知战斗模式。', 422);
      const boosts = unique(Array.isArray(config.boosts) ? config.boosts : []);
      const allowed = rules.boosts ?? ['rare-candy', 'lucky-egg', 'amulet-coin', 'honey', 'shiny-stone', 'master-ball'];
      for (const boost of boosts) if (!allowed.includes(boost) || !state.profile.bag[boost] || config.mode === 'endless' && !['rare-candy', 'lucky-egg', 'amulet-coin'].includes(boost)) throw fail('所选增益道具当前不可用。');
      for (const boost of boosts) if (--state.profile.bag[boost] <= 0) delete state.profile.bag[boost];
      const ticket = { id: `rea-run-${now().toString(36)}-${random().toString(36)}`, seed: random(), ranked: false, local: true, offline: false, boosts };
      state.tickets[ticket.id] = { ticket, config: { species: config.species, biome: config.biome, tier: config.tier, mode: config.mode }, started: now() };
      write(state);
      activeTickets.add(ticket.id);
      return clone(ticket);
    },
    checkpoint(account, ticket, checkpoint) {
      const state = stateFor(account);
      if (!state.tickets[ticket.id]) return;
      (state.checkpoints[ticket.id] ??= []).push(clean(checkpoint));
      write(state);
    },
    keepLive(account, ticket, result) {
      const state = stateFor(account);
      if (!state.tickets[ticket.id]) return;
      state.live = { ticket: clone(ticket), result: clean(result), at: now() };
      write(state);
    },
    async finishRun(account, ticket, result) {
      const state = stateFor(account);
      const previous = state.completed[ticket.id];
      if (previous) {
        pendingFinishes.delete(ticket.id);
        return { ...clone(previous), profile: normalize(state.profile), ranked: false, local: true, reason: localReason, weekPb: false, medal: null };
      }
      const response = applyResult(state, ticket, result);
      // Validation succeeded and the caller has ended this run. If the write
      // fails, keep the full result in memory for an exact retry this session.
      activeTickets.delete(ticket.id);
      try { write(state); } catch (error) {
        pendingFinishes.set(ticket.id, { account: account.id, ticket: clone(ticket), result: clean(result) });
        throw error;
      }
      pendingFinishes.delete(ticket.id);
      return clone(response);
    },
    hasPending(account) { const state = read(); return !!state && account?.id === state.account.id && pendingIds(account, state).size > 0; },
    async retryNow(account) {
      const before = pendingIds(account, stateFor(account));
      for (const item of [...pendingFinishes.values()]) if (item.account === account.id) await backend.finishRun(account, item.ticket, item.result);
      await backend.loadProfile(account);
      const after = pendingIds(account, stateFor(account));
      return { left: after.size, saved: [...before].filter(id => !after.has(id)).length };
    },
    async records(account) { stateFor(account); return []; },
    async endlessRecords(account) { stateFor(account); return []; },
    async news() { return [{ id: 'rea-offline', tag: 'aviso', date: now(), title: 'REA 本地离线还原', summary: '仅保存此浏览器的本地进度，账号、云端排名和社交不可用。', body: '保留原客户端战斗与美术。服务端结算无法完整还原；通用战斗星尘未发放，已知闪光捕获和任务奖励按客户端规则保存。' }]; },
    // Local-only backup; deliberately does not read, import, or write pb.* keys.
    exportLocalSave() { return clone(read()); },
  };
  for (const method of ['req', 'nameStatus', 'register', 'login', 'upgradeGuest', 'renameAccount', 'renameWait', 'resetProgress', 'deleteAccount', 'board', 'monBoards', 'seasonAwards', 'claimSeasonAwards', 'player', 'runBuild', 'report', 'sendFeedback', 'searchPlayers', 'clanPost', 'clanStatus', 'clan', 'createClan', 'clanEmblem', 'clanRename', 'clanInvite', 'clanUninvite', 'clanKick', 'clanRole', 'leaveClan', 'disbandClan', 'clanBoard', 'clanActivity', 'searchClans', 'mail', 'readMail', 'answerMail', 'claimMail', 'clanSettings', 'clanNotice', 'expandClan', 'joinClan', 'withdrawJoin', 'answerJoin', 'friends', 'addFriend', 'cancelFriend', 'removeFriend']) backend[method] = async () => disabled();
  return backend;
}
