import React, { useEffect, useState, useMemo } from "react";
import { Input, Form, Button, Switch, Flex, Collapse, Select, Spin, Tag, Space, Tooltip, Radio } from "antd";
import { SearchOutlined, SortAscendingOutlined, ReloadOutlined } from "@ant-design/icons";
import { ModelConfigFormProps, OpenRouterModelConfig, OpenRouterModel } from "./types";

export const DEFAULT_OPENROUTER: OpenRouterModelConfig = {
  provider: "OpenRouterChatCompletionClient",
  config: {
    model: "anthropic/claude-sonnet-4",
    api_key: null,
    base_url: "https://openrouter.ai/api/v1",
    max_retries: 5,
  }
};

const ADVANCED_DEFAULTS = {
  vision: true,
  function_calling: true,
  json_output: true,
  family: "unknown" as const,
  structured_output: true,
  multiple_system_messages: false,
};

type SortField = "name" | "context" | "price";
type SortOrder = "asc" | "desc";

function normalizeConfig(config: any, hideAdvancedToggles?: boolean) {
  const newConfig = { ...DEFAULT_OPENROUTER, ...config };
  if (hideAdvancedToggles) {
    if (newConfig.config.model_info) delete newConfig.config.model_info;
  } else {
    newConfig.config.model_info = {
      ...ADVANCED_DEFAULTS,
      ...(newConfig.config.model_info || {})
    };
  }
  return newConfig;
}

function formatContextLength(length: number): string {
  if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`;
  if (length >= 1000) return `${(length / 1000).toFixed(0)}K`;
  return length.toString();
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  if (num === 0) return "Free";
  if (num < 0.000001) return "<$0.01/M";
  return `$${(num * 1000000).toFixed(2)}/M`;
}

function getModalityTags(model: OpenRouterModel): React.ReactNode[] {
  const tags: React.ReactNode[] = [];
  const modalities = model.architecture?.input_modalities || [];

  if (modalities.includes("image")) {
    tags.push(<Tag key="vision" color="blue">Vision</Tag>);
  }
  if (modalities.includes("audio")) {
    tags.push(<Tag key="audio" color="purple">Audio</Tag>);
  }
  if (model.supported_parameters?.includes("tools")) {
    tags.push(<Tag key="tools" color="green">Tools</Tag>);
  }
  if (model.supported_parameters?.includes("reasoning")) {
    tags.push(<Tag key="reasoning" color="orange">Reasoning</Tag>);
  }
  return tags;
}

export const OpenRouterModelConfigForm: React.FC<ModelConfigFormProps> = ({ onChange, onSubmit, value, hideAdvancedToggles }) => {
  const [form] = Form.useForm();
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [filterVision, setFilterVision] = useState(false);
  const [filterTools, setFilterTools] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setModels(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models");
      console.error("Failed to fetch OpenRouter models:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const filteredAndSortedModels = useMemo(() => {
    let result = [...models];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query) ||
        m.description?.toLowerCase().includes(query)
      );
    }

    // Apply capability filters
    if (filterVision) {
      result = result.filter(m => m.architecture?.input_modalities?.includes("image"));
    }
    if (filterTools) {
      result = result.filter(m => m.supported_parameters?.includes("tools"));
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "context":
          comparison = (a.context_length || 0) - (b.context_length || 0);
          break;
        case "price":
          comparison = parseFloat(a.pricing?.prompt || "0") - parseFloat(b.pricing?.prompt || "0");
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [models, searchQuery, sortField, sortOrder, filterVision, filterTools]);

  const modelOptions = useMemo(() => {
    return filteredAndSortedModels.map(model => ({
      value: model.id,
      label: (
        <Flex justify="space-between" align="center" style={{ width: "100%" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {model.name}
          </span>
          <Space size="small" style={{ marginLeft: 8, flexShrink: 0 }}>
            <Tag>{formatContextLength(model.context_length)}</Tag>
            <Tag color={parseFloat(model.pricing?.prompt || "0") === 0 ? "green" : undefined}>
              {formatPrice(model.pricing?.prompt || "0")}
            </Tag>
            {getModalityTags(model)}
          </Space>
        </Flex>
      ),
      model: model,
    }));
  }, [filteredAndSortedModels]);

  const selectedModel = useMemo(() => {
    const modelId = form.getFieldValue(["config", "model"]);
    return models.find(m => m.id === modelId);
  }, [models, form]);

  const handleValuesChange = (_: any, allValues: any) => {
    const mergedConfig = { ...DEFAULT_OPENROUTER.config, ...allValues.config };
    const normalizedConfig = normalizeConfig(mergedConfig, hideAdvancedToggles);
    const newValue = { ...DEFAULT_OPENROUTER, config: normalizedConfig };
    if (onChange) onChange(newValue);
  };

  const handleSubmit = () => {
    const mergedConfig = { ...DEFAULT_OPENROUTER.config, ...form.getFieldsValue().config };
    const normalizedConfig = normalizeConfig(mergedConfig, hideAdvancedToggles);
    const newValue = { ...DEFAULT_OPENROUTER, config: normalizedConfig };
    if (onSubmit) onSubmit(newValue);
  };

  const handleModelSelect = (modelId: string) => {
    const model = models.find(m => m.id === modelId);
    if (model) {
      // Auto-detect capabilities from the model
      const hasVision = model.architecture?.input_modalities?.includes("image") || false;
      const hasTools = model.supported_parameters?.includes("tools") || false;
      const hasJson = model.supported_parameters?.includes("response_format") || false;

      form.setFieldsValue({
        config: {
          ...form.getFieldValue("config"),
          model: modelId,
          model_info: {
            ...form.getFieldValue(["config", "model_info"]),
            vision: hasVision,
            function_calling: hasTools,
            json_output: hasJson,
          }
        }
      });
      handleValuesChange(null, form.getFieldsValue());
    }
  };

  useEffect(() => {
    if (value) {
      form.setFieldsValue(normalizeConfig(value, hideAdvancedToggles));
    }
  }, [value, form, hideAdvancedToggles]);

  return (
    <Form
      form={form}
      initialValues={normalizeConfig(value, hideAdvancedToggles)}
      onFinish={handleSubmit}
      onValuesChange={handleValuesChange}
      layout="vertical"
    >
      <Flex vertical gap="small">
        {/* Search and Filter Controls */}
        <Flex gap="small" wrap align="center">
          <Input
            placeholder="Search models..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
            allowClear
          />
          <Tooltip title="Refresh model list">
            <Button
              icon={<ReloadOutlined spin={loading} />}
              onClick={fetchModels}
              disabled={loading}
            />
          </Tooltip>
        </Flex>

        {/* Sort and Filter Options */}
        <Flex gap="small" wrap align="center">
          <Space size="small">
            <SortAscendingOutlined />
            <Radio.Group
              size="small"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              optionType="button"
            >
              <Radio.Button value="name">Name</Radio.Button>
              <Radio.Button value="context">Context</Radio.Button>
              <Radio.Button value="price">Price</Radio.Button>
            </Radio.Group>
            <Button
              size="small"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              {sortOrder === "asc" ? "A-Z" : "Z-A"}
            </Button>
          </Space>
          <Space size="small">
            <Tag
              color={filterVision ? "blue" : undefined}
              style={{ cursor: "pointer" }}
              onClick={() => setFilterVision(!filterVision)}
            >
              Vision
            </Tag>
            <Tag
              color={filterTools ? "green" : undefined}
              style={{ cursor: "pointer" }}
              onClick={() => setFilterTools(!filterTools)}
            >
              Tools
            </Tag>
          </Space>
          <span style={{ color: "#888", fontSize: 12 }}>
            {filteredAndSortedModels.length} / {models.length} models
          </span>
        </Flex>

        {/* Model Selection */}
        <Form.Item
          label="Model"
          name={["config", "model"]}
          rules={[{ required: true, message: "Please select a model" }]}
        >
          {loading ? (
            <Flex justify="center" style={{ padding: 20 }}>
              <Spin tip="Loading models..." />
            </Flex>
          ) : error ? (
            <Flex vertical align="center" gap="small" style={{ padding: 20 }}>
              <span style={{ color: "#ff4d4f" }}>Failed to load models: {error}</span>
              <Button onClick={fetchModels}>Retry</Button>
            </Flex>
          ) : (
            <Select
              showSearch
              placeholder="Select a model"
              optionFilterProp="children"
              filterOption={(input, option) => {
                const model = option?.model as OpenRouterModel | undefined;
                if (!model) return false;
                const searchStr = input.toLowerCase();
                return (
                  model.name.toLowerCase().includes(searchStr) ||
                  model.id.toLowerCase().includes(searchStr)
                );
              }}
              options={modelOptions}
              onChange={handleModelSelect}
              optionLabelProp="label"
              dropdownStyle={{ maxHeight: 400 }}
              listHeight={350}
              virtual
            />
          )}
        </Form.Item>

        {/* Selected Model Info */}
        {selectedModel && (
          <div style={{
            padding: 12,
            background: "#f5f5f5",
            borderRadius: 6,
            fontSize: 12
          }}>
            <Flex vertical gap={4}>
              <strong>{selectedModel.name}</strong>
              <span style={{ color: "#666" }}>{selectedModel.description?.slice(0, 150)}...</span>
              <Flex gap="small" wrap>
                <Tag>Context: {formatContextLength(selectedModel.context_length)}</Tag>
                <Tag>Input: {formatPrice(selectedModel.pricing?.prompt || "0")}</Tag>
                <Tag>Output: {formatPrice(selectedModel.pricing?.completion || "0")}</Tag>
                {getModalityTags(selectedModel)}
              </Flex>
            </Flex>
          </div>
        )}

        <Collapse style={{ width: "100%" }}>
          <Collapse.Panel key="1" header="Optional Properties">
            <Form.Item
              label="API Key"
              name={["config", "api_key"]}
              rules={[{ required: false }]}
              tooltip="Get your API key from openrouter.ai/keys"
            >
              <Input.Password placeholder="sk-or-..." />
            </Form.Item>
            <Form.Item
              label="Base URL"
              name={["config", "base_url"]}
              rules={[{ required: false }]}
            >
              <Input placeholder="https://openrouter.ai/api/v1" />
            </Form.Item>
            <Form.Item
              label="Max Retries"
              name={["config", "max_retries"]}
              rules={[{ type: "number", min: 1, max: 20, message: "Enter a value between 1 and 20" }]}
            >
              <Input type="number" />
            </Form.Item>
            {!hideAdvancedToggles && (
              <Flex gap="small" wrap justify="space-between">
                <Form.Item label="Vision" name={["config", "model_info", "vision"]} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="Function Calling" name={["config", "model_info", "function_calling"]} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="JSON Output" name={["config", "model_info", "json_output"]} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="Structured Output" name={["config", "model_info", "structured_output"]} valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="Multiple System Messages" name={["config", "model_info", "multiple_system_messages"]} valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Flex>
            )}
          </Collapse.Panel>
        </Collapse>
        {onSubmit && <Button onClick={handleSubmit}>Save</Button>}
      </Flex>
    </Form>
  );
};
