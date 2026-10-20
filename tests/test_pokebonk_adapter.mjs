// Self-generated sample rules and inputs only. Does not import/execute game code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../offline-adapter.js', import.meta.url), 'utf8');
const { createReaLocalBackend } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const memory = () => { const values = new Map([['pb.session', 'UNTOUCHED']]); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const profile = name => ({ name, starter: 0, league: [], unlocked: [], seen: [], forms: [], played: [], shinies: [], skins: [], captured: {}, research: {}, counters: {}, lab: {}, itemsOwned: [], itemsOff: [], quests: {}, settings: { music: 0.5 }, stardust: 0, totalStardust: 0, biomes: { forest: 0 }, bag: {}, runs: [], best: {}, kills: {}, medals: {}, times: {}, endless: {}, daily: { ids: ['kills', 'level'], prog: [0, 0], claimed: [0, 0] }, weekly: { ids: ['runs'], prog: [0], claimed: [0] } });
const rules = {
  createProfile: profile, normalizeProfile: p => p, starters: [1, 4, 7],
  refreshTasks() {}, biomes: [{ id: 'forest' }, { id: 'desert' }], biomeEnabled: id => id !== 'future',
  leagueHas: id => [1, 4, 7, 10].includes(id), leagueReady: (p, id) => id === 10 && p.counters.kills >= 2,
  counterCaps: () => ({ evolutions: 10, rocks: 100, gold: 100 }), shinyRewards: { first: 12, repeat: 5 },
  task: id => ({ kills: { id, metric: 'kills', goal: 2 }, level: { id, metric: 'level', goal: 3 }, runs: { id, metric: 'runs', goal: 2 } })[id],
  score: r => r.kills * 2,
  buyLab: (p, id) => { if (id !== 'power' || p.stardust < 10 || p.lab[id]) return false; p.stardust -= 10; p.lab[id] = 1; return true; },
  buyItem: () => false, archiveItem: () => false,
  claimQuest: (p, id) => { if (id !== 'sample' || p.quests[id] || (p.counters.kills ?? 0) < 2) return false; p.quests[id] = 1; p.stardust += 10; p.totalStardust += 10; return true; },
  claimTask: () => false, rerollTask: () => false,
};
const dex = { has: id => [1, 4, 7, 10, 11].includes(id), family: id => id === 11 ? 10 : id, researchGoal: () => 5 };
const storage = memory();
let sequence = 100;
const options = { rules, storage, dex, now: () => 1000, random: () => sequence++ };
const backend = createReaLocalBackend(options);
assert.equal(backend.kind, 'local');
assert.equal((await backend.status()).maintenance.on, false);
assert.equal(await backend.restore(), null);
const account = await backend.guest();
assert.equal(account.local, true);
assert.equal(account.guest, true);
assert.equal(account.token, undefined);
assert.equal((await backend.loadProfile(account)).starter, 0);
await assert.rejects(backend.chooseStarter(account, 99), /初始/);
let p = await backend.chooseStarter(account, 4);
assert.deepEqual(p.league, [4]);
await assert.rejects(backend.chooseStarter(account, 1), /已选择/);
p.stardust = 999999;
p.counters.kills = 999999;
p.settings.music = 0.25;
await backend.savePrefs(account, p);
p = await backend.loadProfile(account);
assert.equal(p.stardust, 0);
assert.equal(p.counters.kills, undefined);
assert.equal(p.settings.music, 0.25);
await assert.rejects(backend.startRun(account, { species: 1, biome: 'forest', tier: 0, mode: 'standard' }), /联盟/);
await assert.rejects(backend.startRun(account, { species: 4, biome: 'desert', tier: 0, mode: 'standard' }), /难度/);
await assert.rejects(backend.startRun(account, { species: 4, biome: 'forest', tier: 0, mode: 'standard', boosts: ['honey'] }), /道具/);
const cfg = { species: 4, biome: 'forest', tier: 0, mode: 'standard' };
const result = { ...cfg, finalSpecies: 4, time: 60, kills: 2, damage: 100, level: 3, stage: 4, bosses: 1, alphas: 0, legendaries: 0, reactions: 2, victory: true, splits: [10, 20, 30], progress: { counters: { rocks: 2, arbitrary: 777 }, research: { 11: 8 }, seen: [10, 11, 999], league: [10, 999], shinies: [11], forms: [11] } };
const ticket = await backend.startRun(account, cfg);
assert.equal(ticket.ranked, false);
assert.equal(ticket.local, true);
await assert.rejects(backend.finishRun(account, ticket, { ...result, species: 1 }), /不一致/);
backend.checkpoint(account, ticket, { time: 15 });
backend.keepLive(account, ticket, result);
assert.equal((await backend.loadProfile(account)).runs.length, 0, 'active backend must not rescue its own live run on resync');
assert.deepEqual(await backend.retryNow(account), { left: 1, saved: 0 }, 'retry must not falsely claim an active snapshot has been committed');
let finish = await backend.finishRun(account, ticket, result);
assert.equal(finish.stardust, 12, 'only injected known shiny rewards are credited');
assert.equal(finish.profile.counters.runs, 1);
assert.equal(finish.profile.counters.rocks, 2);
assert.equal(finish.profile.counters.arbitrary, undefined);
assert.equal(finish.profile.counters.captures, 1);
assert.deepEqual(finish.profile.league, [4, 10]);
assert.equal(finish.profile.research[10], 5);
assert.equal(finish.profile.biomes.forest, 1);
assert.equal(finish.profile.biomes.desert, 0);
assert.deepEqual(finish.profile.daily.prog, [2, 3]);
assert.equal(finish.profile.weekly.prog[0], 1);
assert.equal(finish.record.ranked, false);
assert.match(finish.reason, /本地离线记录/);
assert.equal(finish.tasks.length, 2);
assert.equal(finish.profile.runs.length, 1);
assert.equal(finish.profile.times['forest-0'].time, 60);
await backend.finishRun(account, ticket, result);
assert.equal((await backend.loadProfile(account)).counters.runs, 1, 'finish is idempotent');
await backend.claimQuest(account, 'sample');
await assert.rejects(backend.claimQuest(account, 'sample'), /不足/);
p = await backend.buyLab(account, 'power');
assert.equal(p.stardust, 12);
assert.equal(p.lab.power, 1);
await assert.rejects(backend.buyLab(account, 'power'), /不足/);
for (const name of ['login', 'register', 'board', 'friends', 'clanStatus', 'sendFeedback', 'req']) await assert.rejects(backend[name](), /离线还原版/);
assert.equal(storage.values.get('pb.session'), 'UNTOUCHED');
assert.deepEqual([...storage.values.keys()], ['pb.session', 'rea.pokebonk.0.7.8.state.v1']);
const next = await backend.startRun(account, cfg);
backend.keepLive(account, next, { ...result, victory: false });
const reopened = createReaLocalBackend(options);
p = await reopened.loadProfile(account);
assert.equal(p.counters.runs, 2);
assert.equal(p.runs[0].end.how, 'rescued');
assert.equal(p.runs[0].victory, false);
assert.equal(p.stardust, 17, 'repeat shiny uses injected repeat reward');
assert.equal((await reopened.loadProfile(account)).counters.runs, 2, 'recovery is idempotent');
await reopened.logout();
assert.equal(await reopened.restore(), null);
await assert.rejects(reopened.loadProfile(account), /已退出/);
assert.equal((await reopened.guest()).id, account.id);
assert.equal((await reopened.loadProfile(account)).runs.length, 2);
assert.equal((await reopened.news())[0].tag, 'aviso', 'the real client renders news.tag, not news.kind');

const quotaMemory = memory();
let failNextWrite = false;
const transientQuota = { getItem: key => quotaMemory.getItem(key), setItem: (key, value) => { if (failNextWrite) { failNextWrite = false; throw new Error('quota'); } quotaMemory.setItem(key, value); } };
const quotaBackend = createReaLocalBackend({ ...options, storage: transientQuota });
const quotaAccount = await quotaBackend.guest();
await quotaBackend.chooseStarter(quotaAccount, 4);
const quotaTicket = await quotaBackend.startRun(quotaAccount, cfg);
quotaBackend.keepLive(quotaAccount, quotaTicket, { ...result, victory: false });
failNextWrite = true;
await assert.rejects(quotaBackend.finishRun(quotaAccount, quotaTicket, result), /保存失败/);
assert.equal(quotaBackend.exportLocalSave().profile.runs.length, 0);
assert.deepEqual(await quotaBackend.retryNow(quotaAccount), { left: 0, saved: 1 });
assert.equal((await quotaBackend.loadProfile(quotaAccount)).runs.length, 1);
assert.equal((await quotaBackend.loadProfile(quotaAccount)).runs[0].victory, true, 'same-session retry preserves the full final result, not only the earlier snapshot');
assert.equal((await quotaBackend.loadProfile(quotaAccount)).biomes.forest, 1);
assert.deepEqual(await quotaBackend.retryNow(quotaAccount), { left: 0, saved: 0 });
const noSnapshotTicket = await quotaBackend.startRun(quotaAccount, cfg);
failNextWrite = true;
await assert.rejects(quotaBackend.finishRun(quotaAccount, noSnapshotTicket, result), /保存失败/);
assert.equal(quotaBackend.hasPending(quotaAccount), true, 'failed finish remains retryable even without an earlier checkpoint');
await quotaBackend.loadProfile(quotaAccount);
assert.equal(quotaBackend.exportLocalSave().profile.runs.length, 1);
assert.deepEqual(await quotaBackend.retryNow(quotaAccount), { left: 0, saved: 1 });
assert.equal((await quotaBackend.loadProfile(quotaAccount)).runs.length, 2);
const corrupt = memory(); corrupt.setItem('rea.pokebonk.0.7.8.state.v1', 'broken');
await assert.rejects(createReaLocalBackend({ ...options, storage: corrupt }).guest(), /损坏/);
assert.equal(corrupt.getItem('rea.pokebonk.0.7.8.state.v1'), 'broken');
const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
await assert.rejects(createReaLocalBackend({ ...options, storage: full }).guest(), /保存失败/);
assert.throws(() => createReaLocalBackend({ ...options, storageKey: 'pb.session' }), /rea/);
console.log('Pokebonk local adapter: self-generated contract samples passed (no original game execution).');
