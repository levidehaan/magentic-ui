import React, { useState, useEffect } from "react";
import {
  Form,
  Input,
  Select,
  InputNumber,
  Collapse,
  Typography,
  Alert,
} from "antd";
import { ModelConfigFormProps, ClaudeCodeAgentConfig } from "./types";

export const DEFAULT_CLAUDE_CODE: ClaudeCodeAgentConfig = {
  provider: "ClaudeCodeAgent",
  config: {
    work_dir: null,
    allowed_tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task"],
    permission_mode: "default",
    model: null,
    max_turns: 50,
    timeout_seconds: 300,
  },
};

const PERMISSION_MODES = [
  { value: "default", label: "Default (Ask for permission)" },
  { value: "acceptEdits", label: "Accept Edits (Auto-approve file edits)" },
  { value: "acceptAll", label: "Accept All (Auto-approve all actions)" },
];

const AVAILABLE_TOOLS = [
  { value: "Bash", label: "Bash - Execute shell commands" },
  { value: "Read", label: "Read - Read file contents" },
  { value: "Write", label: "Write - Write files" },
  { value: "Edit", label: "Edit - Edit existing files" },
  { value: "Glob", label: "Glob - Find files by pattern" },
  { value: "Grep", label: "Grep - Search file contents" },
  { value: "Task", label: "Task - Launch sub-agents" },
  { value: "WebFetch", label: "WebFetch - Fetch web content" },
  { value: "WebSearch", label: "WebSearch - Search the web" },
  { value: "NotebookEdit", label: "NotebookEdit - Edit Jupyter notebooks" },
];

const CLAUDE_MODELS = [
  { value: "", label: "Auto (use default)" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
];

const ClaudeCodeConfigForm: React.FC<ModelConfigFormProps> = ({
  onChange,
  value,
}) => {
  const [config, setConfig] = useState<ClaudeCodeAgentConfig>(
    (value as ClaudeCodeAgentConfig) || DEFAULT_CLAUDE_CODE
  );

  useEffect(() => {
    if (value && value.provider === "ClaudeCodeAgent") {
      setConfig(value as ClaudeCodeAgentConfig);
    }
  }, [value]);

  const handleConfigChange = (field: string, fieldValue: any) => {
    const newConfig = {
      ...config,
      config: {
        ...config.config,
        [field]: fieldValue,
      },
    };
    setConfig(newConfig);
    onChange?.(newConfig);
  };

  return (
    <Form layout="vertical" size="small">
      <Alert
        message="Claude Code CLI Agent"
        description={
          <Typography.Text>
            This agent uses the Claude Code CLI to perform coding tasks.
            The CLI must be installed (<code>npm install -g @anthropic-ai/claude-code</code>)
            and authenticated.
          </Typography.Text>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form.Item label="Permission Mode" tooltip="How Claude Code handles permission requests">
        <Select
          value={config.config.permission_mode}
          onChange={(v) => handleConfigChange("permission_mode", v)}
          options={PERMISSION_MODES}
        />
      </Form.Item>

      <Form.Item label="Allowed Tools" tooltip="Tools that Claude Code is allowed to use">
        <Select
          mode="multiple"
          value={config.config.allowed_tools}
          onChange={(v) => handleConfigChange("allowed_tools", v)}
          options={AVAILABLE_TOOLS}
          placeholder="Select allowed tools"
        />
      </Form.Item>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: "advanced",
            label: "Advanced Options",
            children: (
              <>
                <Form.Item label="Claude Model" tooltip="Specific Claude model to use (optional)">
                  <Select
                    value={config.config.model || ""}
                    onChange={(v) => handleConfigChange("model", v || null)}
                    options={CLAUDE_MODELS}
                    placeholder="Auto (use default)"
                  />
                </Form.Item>

                <Form.Item label="Working Directory" tooltip="Directory for Claude Code execution (optional)">
                  <Input
                    value={config.config.work_dir || ""}
                    onChange={(e) =>
                      handleConfigChange("work_dir", e.target.value || null)
                    }
                    placeholder="Uses current directory if not specified"
                  />
                </Form.Item>

                <Form.Item label="Max Turns" tooltip="Maximum number of agentic turns">
                  <InputNumber
                    min={1}
                    max={200}
                    value={config.config.max_turns}
                    onChange={(v) => handleConfigChange("max_turns", v || 50)}
                    style={{ width: "100%" }}
                  />
                </Form.Item>

                <Form.Item label="Timeout (seconds)" tooltip="Maximum execution time in seconds">
                  <InputNumber
                    min={30}
                    max={3600}
                    value={config.config.timeout_seconds}
                    onChange={(v) => handleConfigChange("timeout_seconds", v || 300)}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </>
            ),
          },
        ]}
      />
    </Form>
  );
};

export default ClaudeCodeConfigForm;
