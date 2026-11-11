"""Audio rendered ahead of time that can be played while it is still being rendered."""

import asyncio
from collections.abc import AsyncIterator


class AudioBuffer:
    """Collects TTS chunks in the background; any number of readers replay from the start."""

    def __init__(self, source: AsyncIterator[bytes]) -> None:
        self.chunks: list[bytes] = []
        self.done = False
        self.error: BaseException | None = None
        self._more = asyncio.Event()
        self.task = asyncio.create_task(self._fill(source))

    async def _fill(self, source: AsyncIterator[bytes]) -> None:
        try:
            async for chunk in source:
                self.chunks.append(chunk)
                self._wake()
        except asyncio.CancelledError:
            self.error = RuntimeError("pre-rendering cancelled")
            raise
        except Exception as e:  # noqa: BLE001 - the reader decides how to fall back
            self.error = e
        finally:
            self.done = True
            self._wake()

    def _wake(self) -> None:
        self._more.set()
        self._more = asyncio.Event()

    def cancel(self) -> None:
        if not self.task.done():
            self.task.cancel()

    async def __aiter__(self) -> AsyncIterator[bytes]:
        i = 0
        while True:
            if i < len(self.chunks):
                yield self.chunks[i]
                i += 1
                continue
            if self.done:
                if self.error is not None and i == 0:
                    raise self.error
                return
            await self._more.wait()
