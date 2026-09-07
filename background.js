const persistChains = new Map();

function persistLatestState(key, state) {
  const previous = persistChains.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const current = (await chrome.storage.local.get(key))[key];
    const incomingRevision = Number(state?.stateRevision || 0);
    const currentRevision = Number(current?.stateRevision || 0);

    // 多标签页/异步消息可能交错到达。明确拒绝 revision 更旧的快照，
    // 避免后台自动同步把另一个标签页刚完成的本地操作覆盖掉。
    if (current && currentRevision > incomingRevision) {
      return { ok:true, ignored:true, reason:'stale-revision' };
    }
    await chrome.storage.local.set({ [key]: state });
    return { ok:true, ignored:false };
  });
  persistChains.set(key, task);
  task.finally(() => {
    if (persistChains.get(key) === task) persistChains.delete(key);
  }).catch(() => {});
  return task;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'cgpt-explorer-persist' || !message.key || !message.state) return;
  persistLatestState(message.key, message.state)
    .then(sendResponse)
    .catch(err => sendResponse({ ok:false, error:String(err?.message || err) }));
  return true;
});
