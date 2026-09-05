import { useChainId, useSwitchChain } from 'wagmi';
import { SEPOLIA_CHAIN_ID } from '../config/contracts';

export function useNetworkGuard() {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const switchToSepolia = () => switchChain({ chainId: SEPOLIA_CHAIN_ID });

  return { isSepolia, switchToSepolia, isSwitching: isPending };
}
