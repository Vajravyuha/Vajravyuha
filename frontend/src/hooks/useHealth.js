import { useCallback, useState } from 'react';
import { coreClient } from '../api/coreClient';
import { mockApi } from '../api/mock';
import { usePolling } from './usePolling';

const mocked = import.meta.env.VITE_USE_MOCK === 'true';
export function useHealth() {
  const [health, setHealth] = useState({ core: null, atlas: null, checkedAt: null, error: '' });
  const check = useCallback(async (signal) => {
    try { const data = await (mocked ? mockApi.health() : coreClient.health(signal)); setHealth({ core: data?.ok === true, atlas: data?.atlas === 'up', checkedAt: new Date(), error: '' }); }
    catch (error) { setHealth({ core: false, atlas: null, checkedAt: new Date(), error: error.message }); }
  }, []);
  usePolling(check, 10000, true, [check]);
  return health;
}
