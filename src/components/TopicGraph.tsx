import { Check, Lock, MessageCircle, Play, RotateCcw, X } from "lucide-react";
import { FREE_CONVERSATION_TOPIC_ID, TOPIC_TREE, getLevelLabel, getTopicProgress, isTopicUnlocked, type Topic } from "../data/topicTree";
import { useTopicProgress } from "../hooks/useTopicProgress";

type TopicGraphProps = {
    selectedTopic: string;
    onClose: () => void;
    onSelectTopic: (topicId: string) => void;
};

type Point = { x: number; y: number };

const NODE_WIDTH = 190;
const NODE_HEIGHT = 118;

const positions: Record<string, Point> = {
    greetings: { x: 55, y: 120 },
    introductions: { x: 55, y: 410 },
    daily_life: { x: 330, y: 45 },
    food: { x: 330, y: 265 },
    numbers_time: { x: 330, y: 485 },
    shopping: { x: 610, y: 105 },
    hobbies: { x: 610, y: 300 },
    travel: { x: 610, y: 495 },
    work: { x: 890, y: 35 },
    health: { x: 890, y: 275 },
    weather: { x: 890, y: 500 },
};

const topicIcons: Record<string, string> = {
    greetings: "👋", introductions: "🙂", daily_life: "☀️", food: "🍜",
    numbers_time: "🕒", shopping: "🛍️", travel: "✈️", hobbies: "🎨",
    work: "💼", health: "💪", weather: "🌦️",
};

const levelColors: Record<number, string> = { 1: "#62d6a7", 2: "#61a8ff", 3: "#ab83ff", 4: "#ff9f68" };

function connectionPath(from: Point, to: Point): string {
    const startX = from.x + NODE_WIDTH;
    const startY = from.y + NODE_HEIGHT / 2;
    const endX = to.x;
    const endY = to.y + NODE_HEIGHT / 2;
    const bend = Math.max(45, (endX - startX) * 0.52);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

export default function TopicGraph({ selectedTopic, onClose, onSelectTopic }: TopicGraphProps) {
    const { progress, resetProgress, markTopicVisited } = useTopicProgress();

    const selectTopic = (topic: Topic) => {
        if (!isTopicUnlocked(topic.id, progress)) return;
        markTopicVisited(topic.id);
        onSelectTopic(topic.id);
        onClose();
    };

    const connections = TOPIC_TREE.flatMap((topic) =>
        topic.prerequisites.map((prerequisite) => ({ from: prerequisite, to: topic.id }))
    );

    return (
        <div id="topic-graph" className="topicGraphOverlay" role="dialog" aria-modal="true" aria-labelledby="topic-graph-title">
            <header className="topicGraphHeader">
                <div>
                    <p className="topicGraphEyebrow">Skill tree</p>
                    <h2 id="topic-graph-title">Choose your next challenge</h2>
                    <p>Follow the connected paths to unlock more advanced conversations.</p>
                </div>
                <div className="topicGraphActions">
                    <button
                        type="button"
                        className={`topicGraphFree${selectedTopic === FREE_CONVERSATION_TOPIC_ID ? " isActive" : ""}`}
                        onClick={() => {
                            onSelectTopic(FREE_CONVERSATION_TOPIC_ID);
                            onClose();
                        }}
                        aria-pressed={selectedTopic === FREE_CONVERSATION_TOPIC_ID}
                    >
                        <MessageCircle size={16} /> Free conversation
                    </button>
                    <button type="button" className="topicGraphReset" onClick={resetProgress}><RotateCcw size={16} /> Reset progress</button>
                    <button type="button" className="topicGraphClose" onClick={onClose} aria-label="Close topics"><X size={22} /></button>
                </div>
            </header>

            <div className="topicGraphScroller">
                <div className="skillTreeCanvas">
                    {[1, 2, 3, 4].map((level) => (
                        <div className="skillTreeLevelBand" key={level} style={{ left: 35 + (level - 1) * 280 }}>
                            <span style={{ color: levelColors[level] }}>LEVEL {level}</span>
                            <strong>{getLevelLabel(level)}</strong>
                        </div>
                    ))}

                    <svg className="skillTreeLines" viewBox="0 0 1130 650" aria-hidden="true">
                        <defs>
                            <filter id="path-glow" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        </defs>
                        {connections.map(({ from, to }) => {
                            const sourceComplete = getTopicProgress(from, progress).completed;
                            const targetUnlocked = isTopicUnlocked(to, progress);
                            return <path key={`${from}-${to}`} d={connectionPath(positions[from], positions[to])} className={`skillTreeLine${sourceComplete ? " isComplete" : ""}${targetUnlocked ? " isUnlocked" : ""}`} />;
                        })}
                    </svg>

                    {TOPIC_TREE.map((topic) => {
                        const unlocked = isTopicUnlocked(topic.id, progress);
                        const topicProgress = getTopicProgress(topic.id, progress);
                        const active = selectedTopic === topic.id;
                        const percentage = Math.min(100, (topicProgress.conversationCount / topic.conversationsNeeded) * 100);
                        const prerequisites = topic.prerequisites.map((id) => TOPIC_TREE.find((item) => item.id === id)?.label ?? id).join(" or ");

                        return (
                            <button
                                type="button"
                                key={topic.id}
                                className={`skillTreeNode${active ? " isActive" : ""}${topicProgress.completed ? " isComplete" : ""}${!unlocked ? " isLocked" : ""}`}
                                style={{ left: positions[topic.id].x, top: positions[topic.id].y, "--level-color": levelColors[topic.level] } as React.CSSProperties}
                                onClick={() => selectTopic(topic)}
                                disabled={!unlocked}
                                aria-current={active ? "step" : undefined}
                                title={!unlocked ? `Complete one of: ${prerequisites}` : topic.description}
                            >
                                <span className="skillTreeIcon">{topicIcons[topic.id]}</span>
                                <span className="skillTreeNodeCopy"><strong>{topic.label}</strong><small>{topicProgress.completed ? "Mastered" : `${topicProgress.conversationCount} / ${topic.conversationsNeeded}`}</small></span>
                                <span className="skillTreeNodeState">{!unlocked ? <Lock size={16} /> : topicProgress.completed ? <Check size={17} /> : active ? <Play size={15} fill="currentColor" /> : null}</span>
                                <span className="skillTreeProgress"><span style={{ width: `${percentage}%` }} /></span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <footer className="topicGraphLegend">
                <span><i className="legendAvailable" /> Available</span><span><i className="legendCurrent" /> Current</span><span><i className="legendComplete" /> Mastered</span><span><Lock size={13} /> Locked</span>
                <small>Tip: drag the scrollbar to explore the full tree</small>
            </footer>
        </div>
    );
}
