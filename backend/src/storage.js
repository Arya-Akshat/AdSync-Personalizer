const memoryStore = {
  latestRun: null
};

export const saveRun = (payload) => {
  memoryStore.latestRun = {
    ...payload,
    savedAt: new Date().toISOString()
  };
};

export const getLatestRun = () => memoryStore.latestRun;
