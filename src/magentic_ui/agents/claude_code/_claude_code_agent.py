"""Claude Code Agent - An agent that uses Claude Code CLI for task execution.

This agent invokes Claude Code (the Anthropic CLI tool) as a subprocess to handle
complex coding and file manipulation tasks. It provides a bridge between the
Magentic-UI agent system and Claude Code's powerful capabilities.
"""

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any, AsyncGenerator, List, Mapping, Optional, Sequence

from loguru import logger
from pydantic import BaseModel, Field
from typing_extensions import Self

from autogen_core import CancellationToken, Component
from autogen_agentchat.agents import BaseChatAgent
from autogen_agentchat.base import Response
from autogen_agentchat.state import BaseState
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    TextMessage,
    MessageFactory,
)


class ClaudeCodeAgentConfig(BaseModel):
    """Configuration for the Claude Code Agent."""

    name: str
    description: str = """
    An agent powered by Claude Code CLI that can write, execute, and debug code,
    manipulate files, search codebases, and perform complex software engineering tasks.
    It has access to the full Claude Code toolset including Bash, Read, Write, Edit, Glob, Grep, and more.
    """
    work_dir: Optional[str] = None
    allowed_tools: List[str] = Field(
        default_factory=lambda: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task"]
    )
    permission_mode: str = "default"  # "default", "acceptEdits", "acceptAll"
    model: Optional[str] = None  # e.g., "opus-4-5", "sonnet-4"
    max_turns: int = 50
    timeout_seconds: int = 300


class ClaudeCodeAgentState(BaseState):
    """State for the Claude Code Agent."""

    chat_history: List[BaseChatMessage] = Field(default_factory=list)
    type: str = Field(default="ClaudeCodeAgentState")


class ClaudeCodeAgent(BaseChatAgent, Component[ClaudeCodeAgentConfig]):
    """An agent that delegates tasks to Claude Code CLI.

    This agent invokes Claude Code in headless mode (-p flag) to handle complex
    coding tasks, file manipulation, and codebase exploration. It captures the
    output and streams it back to the Magentic-UI interface.

    Requirements:
        - Claude Code CLI must be installed and available in PATH
        - User must be authenticated with Claude Code (run `claude` first)

    Example:
        ```python
        agent = ClaudeCodeAgent(
            name="claude_code",
            work_dir="/path/to/project",
            allowed_tools=["Bash", "Read", "Edit"],
        )
        ```
    """

    component_type = "agent"
    component_config_schema = ClaudeCodeAgentConfig
    component_provider_override = "magentic_ui.agents.claude_code.ClaudeCodeAgent"

    DEFAULT_DESCRIPTION = """
    An agent powered by Claude Code CLI that can write, execute, and debug code,
    manipulate files, search codebases, and perform complex software engineering tasks.
    It has access to the full Claude Code toolset including Bash, Read, Write, Edit, Glob, Grep, and more.
    Use this agent for complex coding tasks that benefit from Claude Code's capabilities.
    """

    def __init__(
        self,
        name: str,
        description: str = DEFAULT_DESCRIPTION,
        work_dir: Optional[Path | str] = None,
        allowed_tools: Optional[List[str]] = None,
        permission_mode: str = "default",
        model: Optional[str] = None,
        max_turns: int = 50,
        timeout_seconds: int = 300,
    ) -> None:
        """Initialize the Claude Code Agent.

        Args:
            name: The name of the agent
            description: Description of the agent's capabilities
            work_dir: Working directory for Claude Code execution
            allowed_tools: List of tools Claude Code is allowed to use
            permission_mode: Permission mode ("default", "acceptEdits", "acceptAll")
            model: Claude model to use (e.g., "opus-4-5", "sonnet-4")
            max_turns: Maximum number of agentic turns
            timeout_seconds: Timeout for Claude Code execution
        """
        super().__init__(name, description)
        self._work_dir = Path(work_dir) if work_dir else Path.cwd()
        self._allowed_tools = allowed_tools or [
            "Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task"
        ]
        self._permission_mode = permission_mode
        self._model = model
        self._max_turns = max_turns
        self._timeout_seconds = timeout_seconds
        self._chat_history: List[BaseChatMessage] = []
        self._claude_available: Optional[bool] = None

    async def _check_claude_available(self) -> bool:
        """Check if Claude Code CLI is available."""
        if self._claude_available is not None:
            return self._claude_available

        claude_path = shutil.which("claude")
        if claude_path is None:
            logger.warning("Claude Code CLI not found in PATH")
            self._claude_available = False
            return False

        try:
            proc = await asyncio.create_subprocess_exec(
                "claude", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            self._claude_available = proc.returncode == 0
            if self._claude_available:
                logger.info(f"Claude Code CLI available: {stdout.decode().strip()}")
            return self._claude_available
        except Exception as e:
            logger.warning(f"Failed to check Claude Code CLI: {e}")
            self._claude_available = False
            return False

    def _build_command(self, prompt: str) -> List[str]:
        """Build the Claude Code CLI command."""
        cmd = ["claude", "-p", prompt]

        # Output format
        cmd.extend(["--output-format", "stream-json"])

        # Allowed tools
        if self._allowed_tools:
            cmd.extend(["--allowedTools", ",".join(self._allowed_tools)])

        # Permission mode
        if self._permission_mode == "acceptAll":
            cmd.extend(["--permission-mode", "acceptAll"])
        elif self._permission_mode == "acceptEdits":
            cmd.extend(["--permission-mode", "acceptEdits"])

        # Model
        if self._model:
            cmd.extend(["--model", self._model])

        # Max turns
        cmd.extend(["--max-turns", str(self._max_turns)])

        return cmd

    async def _run_claude_code(
        self,
        prompt: str,
        cancellation_token: CancellationToken,
    ) -> AsyncGenerator[TextMessage, None]:
        """Run Claude Code CLI and stream the output."""
        cmd = self._build_command(prompt)
        logger.info(f"Running Claude Code: {' '.join(cmd)}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._work_dir),
            )

            collected_output: List[str] = []
            current_content = ""

            async def read_stream():
                nonlocal current_content
                assert proc.stdout is not None

                while True:
                    if cancellation_token.is_cancelled():
                        proc.terminate()
                        break

                    line = await proc.stdout.readline()
                    if not line:
                        break

                    try:
                        line_str = line.decode("utf-8").strip()
                        if not line_str:
                            continue

                        # Parse JSON output
                        data = json.loads(line_str)
                        msg_type = data.get("type", "")

                        # Handle different message types
                        if msg_type == "assistant":
                            # Assistant message with content
                            content = data.get("message", {}).get("content", [])
                            for block in content:
                                if block.get("type") == "text":
                                    text = block.get("text", "")
                                    if text:
                                        current_content += text
                                        collected_output.append(text)
                                        yield TextMessage(
                                            source=f"{self.name}-claude",
                                            content=text,
                                            metadata={"internal": "no", "type": "claude_output"},
                                        )

                        elif msg_type == "content_block_delta":
                            # Streaming content delta
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                text = delta.get("text", "")
                                if text:
                                    current_content += text
                                    collected_output.append(text)

                        elif msg_type == "tool_use":
                            # Tool being used
                            tool_name = data.get("name", "unknown")
                            tool_input = data.get("input", {})
                            yield TextMessage(
                                source=f"{self.name}-tool",
                                content=f"🔧 Using tool: {tool_name}\n```json\n{json.dumps(tool_input, indent=2)}\n```",
                                metadata={"internal": "no", "type": "tool_use"},
                            )

                        elif msg_type == "tool_result":
                            # Tool execution result
                            result = data.get("content", "")
                            if isinstance(result, list):
                                result = "\n".join(
                                    block.get("text", "") for block in result
                                    if block.get("type") == "text"
                                )
                            if result:
                                # Truncate very long results
                                if len(result) > 2000:
                                    result = result[:2000] + "\n... (truncated)"
                                yield TextMessage(
                                    source=f"{self.name}-result",
                                    content=f"📋 Result:\n```\n{result}\n```",
                                    metadata={"internal": "no", "type": "tool_result"},
                                )

                        elif msg_type == "result":
                            # Final result
                            result_text = data.get("result", "")
                            if result_text and result_text not in collected_output:
                                yield TextMessage(
                                    source=self.name,
                                    content=result_text,
                                    metadata={"internal": "no", "type": "final_result"},
                                )

                        elif msg_type == "error":
                            # Error message
                            error = data.get("error", {})
                            error_msg = error.get("message", str(error))
                            yield TextMessage(
                                source=f"{self.name}-error",
                                content=f"❌ Error: {error_msg}",
                                metadata={"internal": "no", "type": "error"},
                            )

                    except json.JSONDecodeError:
                        # Non-JSON output, treat as plain text
                        if line_str:
                            collected_output.append(line_str)
                            yield TextMessage(
                                source=f"{self.name}-output",
                                content=line_str,
                                metadata={"internal": "no", "type": "raw_output"},
                            )
                    except Exception as e:
                        logger.warning(f"Error parsing Claude Code output: {e}")

            async for msg in read_stream():
                yield msg

            # Wait for process to complete
            try:
                await asyncio.wait_for(
                    proc.wait(),
                    timeout=self._timeout_seconds
                )
            except asyncio.TimeoutError:
                proc.terminate()
                yield TextMessage(
                    source=f"{self.name}-error",
                    content="⏱️ Claude Code execution timed out",
                    metadata={"internal": "no", "type": "error"},
                )

            # Check for errors
            if proc.returncode != 0 and proc.stderr:
                stderr = await proc.stderr.read()
                if stderr:
                    error_text = stderr.decode("utf-8").strip()
                    if error_text:
                        yield TextMessage(
                            source=f"{self.name}-error",
                            content=f"❌ Claude Code error:\n{error_text}",
                            metadata={"internal": "no", "type": "error"},
                        )

        except FileNotFoundError:
            yield TextMessage(
                source=f"{self.name}-error",
                content="❌ Claude Code CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code",
                metadata={"internal": "no", "type": "error"},
            )
        except Exception as e:
            logger.error(f"Error running Claude Code: {e}")
            yield TextMessage(
                source=f"{self.name}-error",
                content=f"❌ Error running Claude Code: {str(e)}",
                metadata={"internal": "no", "type": "error"},
            )

    @property
    def produced_message_types(self) -> Sequence[type[BaseChatMessage]]:
        """Get the types of messages produced by the agent."""
        return (TextMessage,)

    async def on_messages(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> Response:
        """Handle incoming messages and return a single response."""
        response: Response | None = None
        async for message in self.on_messages_stream(messages, cancellation_token):
            if isinstance(message, Response):
                response = message
        assert response is not None
        return response

    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """Handle incoming messages and yield responses as a stream."""
        # Check if Claude Code is available
        if not await self._check_claude_available():
            yield Response(
                chat_message=TextMessage(
                    content=(
                        "❌ Claude Code CLI is not available. Please install it:\n\n"
                        "```bash\nnpm install -g @anthropic-ai/claude-code\n```\n\n"
                        "Then authenticate by running `claude` once."
                    ),
                    source=self.name,
                    metadata={"internal": "no"},
                )
            )
            return

        # Add messages to history
        self._chat_history.extend(messages)

        # Extract the prompt from the last message
        last_message = messages[-1]
        if hasattr(last_message, "content"):
            prompt = str(last_message.content)
        else:
            prompt = str(last_message)

        # Build context from chat history for multi-turn conversations
        if len(self._chat_history) > 1:
            context_parts = []
            for msg in self._chat_history[:-1]:
                if hasattr(msg, "content") and hasattr(msg, "source"):
                    context_parts.append(f"{msg.source}: {msg.content}")
            if context_parts:
                context = "\n".join(context_parts[-10:])  # Last 10 messages
                prompt = f"Previous context:\n{context}\n\nCurrent request:\n{prompt}"

        inner_messages: List[BaseChatMessage] = []
        final_content_parts: List[str] = []

        # Run Claude Code and stream output
        async for msg in self._run_claude_code(prompt, cancellation_token):
            inner_messages.append(msg)
            self._chat_history.append(msg)
            yield msg

            # Collect content for final response
            if hasattr(msg, "content"):
                final_content_parts.append(msg.content)

        # Create final response
        final_content = "\n".join(final_content_parts) if final_content_parts else "Task completed."
        final_message = TextMessage(
            source=self.name,
            content=final_content,
            metadata={"internal": "yes"},
        )

        yield Response(chat_message=final_message, inner_messages=inner_messages)

    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        """Clear the chat history."""
        self._chat_history.clear()

    def _to_config(self) -> ClaudeCodeAgentConfig:
        """Convert the agent's state to a configuration object."""
        return ClaudeCodeAgentConfig(
            name=self.name,
            description=self.description,
            work_dir=str(self._work_dir) if self._work_dir else None,
            allowed_tools=self._allowed_tools,
            permission_mode=self._permission_mode,
            model=self._model,
            max_turns=self._max_turns,
            timeout_seconds=self._timeout_seconds,
        )

    @classmethod
    def _from_config(cls, config: ClaudeCodeAgentConfig) -> Self:
        """Create an agent instance from a configuration object."""
        return cls(
            name=config.name,
            description=config.description,
            work_dir=config.work_dir,
            allowed_tools=config.allowed_tools,
            permission_mode=config.permission_mode,
            model=config.model,
            max_turns=config.max_turns,
            timeout_seconds=config.timeout_seconds,
        )

    async def save_state(self) -> Mapping[str, Any]:
        """Save the state of the agent."""
        return {
            "chat_history": [msg.dump() for msg in self._chat_history],
        }

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the agent."""
        message_factory = MessageFactory()
        self._chat_history = []
        for msg_data in state.get("chat_history", []):
            msg = message_factory.create(msg_data)
            assert isinstance(msg, BaseChatMessage)
            self._chat_history.append(msg)
