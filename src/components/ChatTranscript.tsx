import type { Message } from "../types/chat";

type ChatTranscriptProps = {
    messages: Message[];
    loading: boolean;
};

export default function ChatTranscript({
                                           messages,
                                           loading,
                                       }: ChatTranscriptProps) {
    return (
        <div
            className="uiAnswer"
            style={{
                position: "fixed",
                left: 250,
                bottom: 20,
                width: 400,
                height: 880,
                backgroundColor: "rgba(100,100,100,0.55)",
                color: "white",
                padding: 20,
                borderRadius: 12,
                fontSize: "18px",
                lineHeight: 1.6,
                overflowY: "auto",
                backdropFilter: "blur(6px)",
                zIndex: 1000,
            }}
        >
            {messages.map((msg, index) => (
                <div key={index}>
                    <strong>{msg.role}:</strong> {msg.content}
                </div>
            ))}

            {loading && <div>Thinking...</div>}
        </div>
    );
}