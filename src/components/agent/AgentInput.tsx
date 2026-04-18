import { ChatInput } from "../chat/ChatInput";
import type { AgentState } from "../chat/types";

interface AgentInputProps {
  agentState: AgentState;
  partialTranscript: string;
  onTextSubmit?: (text: string) => void;
  onCancel?: () => void;
  pendingSubmitText?: string | null;
  onPendingSubmitConsumed?: () => void;
}

export function AgentInput(props: AgentInputProps) {
  return <ChatInput {...props} autoFocus />;
}
