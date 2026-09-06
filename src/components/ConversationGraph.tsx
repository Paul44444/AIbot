import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { ChatMessage } from "../data/exampleConversations";
import { loadAllConversations } from "../data/conversationStorage";

function formatConversationDate(timestamp?: number) {
    if (!timestamp) return "Example conversation";

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(timestamp));
}

type ConversationGraphProps = {
    onClose: () => void;
    onNewConversation: () => void;
    onOpenConversation: (messages: ChatMessage[]) => void;
};

export default function ConversationGraph({ onClose, onOpenConversation, onNewConversation }: ConversationGraphProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [conversations, setConversations] = useState(loadAllConversations);

    useEffect(() => {
        const refreshConversations = () => setConversations(loadAllConversations());
        window.addEventListener("conversation-history-updated", refreshConversations);
        window.addEventListener("storage", refreshConversations);

        return () => {
            window.removeEventListener("conversation-history-updated", refreshConversations);
            window.removeEventListener("storage", refreshConversations);
        };
    }, []);

    const hoveredConversation = conversations.find(
        (conversation) => conversation.id === hoveredId
    );

    return (
        <div id="conversation-graph" className="topicGraphOverlay" role="dialog" aria-modal="true" aria-labelledby="conversation-graph-title">
            <header className="topicGraphHeader">
                <div>
                    <p className="topicGraphEyebrow">Conversation history</p>
                    <h2 id="conversation-graph-title">Your conversation map</h2>
                    <p>Open a saved discussion or explore where your conversations have taken you.</p>
                </div>
                <button type="button" className="topicGraphClose" onClick={onClose} aria-label="Close conversation map">
                    <X size={22} />
                </button>
            </header>

            <div className="conversationGraphCanvas">
                <button
                    type="button"
                    className="conversationGraphNode conversationGraphNew"
                    onClick={onNewConversation}
                    onMouseEnter={() => setHoveredId(null)}
                    onFocus={() => setHoveredId(null)}
                    aria-label="Start new conversation"
                >
                    <span className="conversationGraphIcon"><Plus size={28} aria-hidden="true" /></span>
                    <span className="conversationGraphTitle">New</span>
                </button>
                {conversations.map((conversation) => (
                    <button
                        key={conversation.id}
                        type="button"
                        className="conversationGraphNode"
                        onMouseEnter={() => setHoveredId(conversation.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onFocus={() => setHoveredId(conversation.id)}
                        onBlur={() => setHoveredId(null)}
                        onClick={() => onOpenConversation(conversation.messages)}
                        title={conversation.summary}
                    >
                        <span className="conversationGraphIcon">{conversation.icon}</span>
                        <span className="conversationGraphTitle">{conversation.title}</span>
                    </button>
                ))}

            </div>

            {hoveredConversation && (
                <aside className="conversationGraphPreview">
                    <div className="conversationGraphPreviewHeading">
                        <h3>{hoveredConversation.title}</h3>
                        <time dateTime={hoveredConversation.createdAt
                            ? new Date(hoveredConversation.createdAt).toISOString()
                            : undefined}
                        >
                            {formatConversationDate(hoveredConversation.createdAt)}
                        </time>
                    </div>
                    <p className="conversationGraphSummary">{hoveredConversation.summary}</p>
                    {hoveredConversation.messages.slice(0, 3).map((message, index) => (
                        <p key={index}><strong>{message.role === "user" ? "You" : "Assistant"}:</strong> {message.content}</p>
                    ))}
                </aside>
            )}
        </div>
    );
}
