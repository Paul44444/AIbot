import { useState } from "react";
import Chat from "./components/Chat";
import TopicGraph from "./components/TopicGraph";
import type { ChatMessage } from "./data/exampleConversations";

function App() {
    const [showTopicGraph, setShowTopicGraph] = useState(false);
    const [loadedMessages, setLoadedMessages] =
        useState<ChatMessage[] | null>(null);

    return (
        <>
            <Chat loadedMessages={loadedMessages} />

            <button
                className="topicGraphButton"we
                type="button"
                onClick={() =>
                    setShowTopicGraph((previous) => !previous)
                }
                aria-expanded={showTopicGraph}
                aria-controls="topic-graph"
            >
                <span className="topicGraphDesktopText">
                    {showTopicGraph ? "Close Graph" : "Topic Graph"}
                </span>

                <span className="topicGraphMobileText">
                    {showTopicGraph ? "Close" : "Topics"}
                </span>
            </button>

            {showTopicGraph && (
                <TopicGraph
                    onClose={() => setShowTopicGraph(false)}
                    onOpenConversation={(messages) => {
                        setLoadedMessages(messages);
                        setShowTopicGraph(false);
                    }}
                />
            )}
        </>
    );
}

export default App;