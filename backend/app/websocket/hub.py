import asyncio
from collections import defaultdict


class Hub:
    def __init__(self):
        self.subscribers = defaultdict(set)

    def subscribe(self, run_id):
        queue = asyncio.Queue(maxsize=2)
        self.subscribers[str(run_id)].add(queue)
        return queue

    def unsubscribe(self, run_id, queue):
        listeners = self.subscribers.get(str(run_id))
        if listeners:
            listeners.discard(queue)
            if not listeners:
                self.subscribers.pop(str(run_id), None)

    def publish(self, state):
        envelope = {
            "type": "completion" if state.status in {"completed", "failed", "terminated"} else "update",
            "sequence": state.sequence,
            "state": state.model_dump(mode="json"),
        }
        for queue in tuple(self.subscribers.get(str(state.run_id), ())):
            # Updates contain full history/state; bounded queue can safely keep newest.
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(envelope)
