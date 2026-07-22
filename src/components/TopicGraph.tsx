import { useState } from "react";
import type { ChatMessage } from "../data/exampleConversations";
import { loadAllConversations } from "../data/conversationStorage";
//import { saveConversationNode } from "../data/conversationStorage";

type TopicGraphProps = {
    onClose: () => void;
    onOpenConversation: (messages: ChatMessage[]) => void;
};

export default function TopicGraph({ onClose, onOpenConversation }: TopicGraphProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const [conversations, setConversations] = useState(loadAllConversations);
    void setConversations

    const hoveredConversation = conversations.find(
        (conversation) => conversation.id === hoveredId
    );

    return (
        <div className="topicGraphOverlay">
            <button className="topicGraphClose" onClick={onClose}>
                Close
            </button>

            <div className="topicGraphCanvas">
                {conversations.map((conversation) => (
                    <button
                        key={conversation.id}
                        className="topicGraphNode"
                        style={{
                            left: `calc(50% + ${conversation.x}px)`,
                            top: `calc(50% + ${conversation.y}px)`,
                        }}
                        onMouseEnter={() => setHoveredId(conversation.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => onOpenConversation(conversation.messages)}
                        title={conversation.summary}
                    >
                        <div className="topicGraphIcon">{conversation.icon}</div>
                        <div className="topicGraphTitle">{conversation.title}</div>
                    </button>
                ))}

                {hoveredConversation && (
                    <div className="topicGraphPreview">
                        <h3>{hoveredConversation.title}</h3>

                        {hoveredConversation.messages.slice(0, 3).map((message, index) => (
                            <p key={index}>
                                <strong>{message.role}:</strong> {message.content}
                            </p>
                        ))}

                        <p>...</p>
                    </div>
                )}
            </div>
        </div>
    );
}