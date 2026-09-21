// Pure mapping helpers between the realtime session hook's phase machine and
// a host app's call-state machine. Kept side-effect-free for testability.
import type { RealtimePhase } from './useRealtimeCallSession.ts';

// Mirror of a typical call-state union (SullyOS CallApp uses the same values).
// Hosts with different state names should write their own tiny mapper instead.
export type CallUiState =
  | 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'
  | 'recording' | 'transcribing' | 'ended' | 'error' | 'interrupted';

export function mapRealtimePhaseToCallState(phase: RealtimePhase): CallUiState {
  switch (phase.phase) {
    case 'connecting': return 'connecting';
    case 'ready':
    case 'listening': return 'listening';
    case 'thinking': return 'thinking';
    case 'speaking': return 'speaking';
    case 'interrupted': return 'interrupted';
    case 'error': return 'error';
    default: return 'idle';
  }
}

