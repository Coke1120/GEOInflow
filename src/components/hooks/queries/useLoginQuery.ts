import { setUser, useApp } from '@/store/app';
import { useApi } from '../useApi';
import { getClientAuthToken } from '@/lib/client';

const selector = (state: { user: any }) => state.user;

export function useLoginQuery() {
  const { post, useQuery } = useApi();
  const user = useApp(selector);

  const query = useQuery({
    queryKey: ['login'],
    queryFn: async () => {
      const token = getClientAuthToken();
      const data = await post('/auth/verify');
      if (token !== getClientAuthToken()) throw new DOMException('身份已变更', 'AbortError');
      setUser(data);

      return data;
    },
    enabled: !user,
  });

  return { user, setUser, ...query };
}
