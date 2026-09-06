import { useRef, useState } from "react";
import Chat, { type ChatHandle } from "./components/Chat";
import TopicGraph from "./components/TopicGraph";
import ConversationGraph from "./components/ConversationGraph";
import type { ChatMessage } from "./data/exampleConversations";
import { FREE_CONVERSATION_TOPIC_ID } from "./data/topicTree";
import { MessagesSquare, Network } from "lucide-react";

function App() {
    const chatRef = useRef<ChatHandle>(null);
    const [showTopicGraph, setShowTopicGraph] = useState(false);
    const [showConversationGraph, setShowConversationGraph] = useState(false);
    const [selectedTopic, setSelectedTopic] = useState(FREE_CONVERSATION_TOPIC_ID);
    const [loadedMessages, setLoadedMessages] = useState<ChatMessage[] | null>(null);

    return (
        <>
            <Chat
                ref={chatRef}
                loadedMessages={loadedMessages}
                selectedTopic={selectedTopic}
                onTopicChange={setSelectedTopic}
                pauseSceneStartup={showConversationGraph || showTopicGraph}
            />

            <button
                className="conversationGraphButton"
                type="button"
                onClick={() => {
                    setShowTopicGraph(false);
                    setShowConversationGraph((previous) => !previous);
                }}
                aria-expanded={showConversationGraph}
                aria-controls="conversation-graph"
                aria-label="Open conversation map"
                data-tooltip="Conversation map"
            >
                <MessagesSquare size={22} aria-hidden="true" />
            </button>

            <button
                className="topicGraphButton"
                type="button"
                onClick={() => {
                    setShowConversationGraph(false);
                    setShowTopicGraph((previous) => !previous);
                }}
                aria-expanded={showTopicGraph}
                aria-controls="topic-graph"
                aria-label="Open learning tree"
                data-tooltip="Learning tree"
            >
                <Network size={22} aria-hidden="true" />
            </button>

            {showTopicGraph && (
                <TopicGraph
                    selectedTopic={selectedTopic}
                    onClose={() => setShowTopicGraph(false)}
                    onSelectTopic={setSelectedTopic}
                />
            )}

            {showConversationGraph && (
                <ConversationGraph
                    onNewConversation={() => {
                        chatRef.current?.startNewConversation();
                        setLoadedMessages(null);
                        setSelectedTopic(FREE_CONVERSATION_TOPIC_ID);
                        setShowConversationGraph(false);
                        setShowTopicGraph(false);
                    }}
                    onClose={() => setShowConversationGraph(false)}
                    onOpenConversation={(messages) => {
                        setLoadedMessages(messages);
                        setShowConversationGraph(false);
                    }}
                />
            )}
        </>
    );
}

export default App;
