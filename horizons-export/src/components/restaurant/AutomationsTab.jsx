import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Plus, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TRIGGER_OPTIONS = [
  {
    id: "points_wallet",
    label: "Quantidade de pontos na carteira",
    unit: "pontos",
    min: 1,
    defaultValue: 100,
    template: "Parabens! Voce atingiu {value} pontos. Resgate seu beneficio na proxima visita.",
  },
  {
    id: "expiring_soon",
    label: "Prestes a expirar",
    unit: "dias",
    min: 1,
    defaultValue: 7,
    template: "Seu passe expira em {value} dias. Passe hoje no restaurante para nao perder vantagens.",
  },
  {
    id: "days_without_visit",
    label: "Dias sem visitar",
    unit: "dias",
    min: 1,
    defaultValue: 30,
    template: "Sentimos sua falta ha {value} dias. Volte e aproveite um novo beneficio exclusivo.",
  },
];

function optionById(triggerId) {
  return TRIGGER_OPTIONS.find((item) => item.id === triggerId) || TRIGGER_OPTIONS[0];
}

function buildSuggestedMessage(triggerId, value) {
  const option = optionById(triggerId);
  return option.template.replace("{value}", String(value));
}

function triggerSummary(triggerId, value) {
  const option = optionById(triggerId);
  if (triggerId === "points_wallet") return `Quando o cliente atingir ${value} ${option.unit}`;
  if (triggerId === "expiring_soon") return `Quando faltarem ${value} ${option.unit} para expirar`;
  return `Quando o cliente ficar ${value} ${option.unit} sem visitar`;
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
        checked ? "bg-indigo-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function FlowConnector() {
  return (
    <div className="flex items-center justify-center py-3">
      <svg
        className="h-14 w-6 text-indigo-600"
        viewBox="0 0 24 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M12 2V44M5 37L12 44L19 37"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function AutomationsTab() {
  const [automations, setAutomations] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [activeBox, setActiveBox] = useState("trigger");
  const [triggerId, setTriggerId] = useState(TRIGGER_OPTIONS[0].id);
  const [triggerValue, setTriggerValue] = useState(TRIGGER_OPTIONS[0].defaultValue);
  const [message, setMessage] = useState(buildSuggestedMessage(TRIGGER_OPTIONS[0].id, TRIGGER_OPTIONS[0].defaultValue));

  const selectedTrigger = useMemo(() => optionById(triggerId), [triggerId]);

  function startCreate() {
    const nextOption = TRIGGER_OPTIONS[0];
    setActiveBox("trigger");
    setTriggerId(nextOption.id);
    setTriggerValue(nextOption.defaultValue);
    setMessage(buildSuggestedMessage(nextOption.id, nextOption.defaultValue));
    setIsCreating(true);
  }

  function handleTriggerChange(nextId) {
    const nextOption = optionById(nextId);
    const currentSuggestion = buildSuggestedMessage(triggerId, triggerValue);
    const shouldReplace = !message.trim() || message === currentSuggestion;

    setTriggerId(nextOption.id);
    setTriggerValue(nextOption.defaultValue);

    if (shouldReplace) {
      setMessage(buildSuggestedMessage(nextOption.id, nextOption.defaultValue));
    }
  }

  function handleTriggerValueChange(rawValue) {
    const parsed = Number(rawValue);
    const nextValue = Number.isFinite(parsed) && parsed >= selectedTrigger.min ? parsed : selectedTrigger.min;
    const currentSuggestion = buildSuggestedMessage(triggerId, triggerValue);
    const shouldReplace = !message.trim() || message === currentSuggestion;

    setTriggerValue(nextValue);
    if (shouldReplace) {
      setMessage(buildSuggestedMessage(triggerId, nextValue));
    }
  }

  function saveAutomation() {
    const finalMessage = message.trim() || buildSuggestedMessage(triggerId, triggerValue);

    const newAutomation = {
      id: `automation-${Date.now()}`,
      triggerId,
      triggerLabel: selectedTrigger.label,
      triggerValue,
      message: finalMessage,
      active: true,
      createdAt: new Date().toISOString(),
    };

    setAutomations((prev) => [newAutomation, ...prev]);
    setIsCreating(false);
  }

  function toggleAutomation(automationId) {
    setAutomations((prev) =>
      prev.map((item) => {
        if (item.id !== automationId) return item;
        return { ...item, active: !item.active };
      }),
    );
  }

  if (!isCreating) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-4"
      >
        <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Automacoes</h3>
              <p className="mt-1 text-sm text-gray-600">
                Crie regras para enviar notificacoes automaticamente com base no comportamento dos passes.
              </p>
            </div>
            <Button onClick={startCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Criar
            </Button>
          </div>
        </div>

        {automations.length === 0 ? (
          <div className="rounded-2xl border border-purple-100 bg-white p-10 text-center shadow-lg">
            <Bot className="mx-auto h-10 w-10 text-gray-400" />
            <p className="mt-4 text-base font-medium text-gray-800">Voce nao possui automacoes</p>
            <Button onClick={startCreate} className="mt-4 gap-2">
              <Plus className="h-4 w-4" />
              Criar
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b text-left text-gray-600">
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Mensagem</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((automation) => (
                  <tr key={automation.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{automation.triggerLabel}</p>
                      <p className="text-xs text-gray-500">
                        {triggerSummary(automation.triggerId, automation.triggerValue)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{automation.message}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Toggle
                          checked={automation.active}
                          onChange={() => toggleAutomation(automation.id)}
                        />
                        <span className="text-xs font-medium text-gray-600">
                          {automation.active ? "On" : "Off"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div className="rounded-2xl border border-purple-100 bg-white p-5 shadow-lg">
        <h3 className="text-xl font-semibold text-gray-900">Nova automacao</h3>
        <p className="mt-1 text-sm text-gray-600">
          Defina o trigger, ajuste a mensagem e salve para habilitar o envio automatico.
        </p>
      </div>

      <div
        className="rounded-2xl border border-purple-100 bg-white p-6 shadow-lg"
        style={{
          backgroundImage: "radial-gradient(circle, #ececf5 1px, transparent 1px)",
          backgroundSize: "14px 14px",
        }}
      >
        <div className="mx-auto max-w-2xl py-2">
          <motion.div
            onClick={() => setActiveBox("trigger")}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0 }}
            className={`rounded-2xl bg-white p-6 shadow-lg transition-all cursor-pointer ${
              activeBox === "trigger"
                ? "border-2 border-indigo-400 shadow-xl"
                : "border border-purple-100 hover:border-indigo-200"
            }`}
          >
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-medium text-gray-700">
              <Zap className="h-4 w-4" />
              Trigger
            </div>
            <p className="mb-3 text-sm text-gray-600">Selecione o evento que inicia a automacao.</p>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Tipo de trigger
                </label>
                <select
                  value={triggerId}
                  onChange={(e) => handleTriggerChange(e.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  {TRIGGER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Valor
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={selectedTrigger.min}
                    value={triggerValue}
                    onChange={(e) => handleTriggerValueChange(e.target.value)}
                  />
                  <span className="text-sm text-gray-500">{selectedTrigger.unit}</span>
                </div>
              </div>
            </div>
          </motion.div>

          <FlowConnector />

          <motion.div
            onClick={() => setActiveBox("message")}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={`rounded-2xl bg-white p-6 shadow-lg transition-all cursor-pointer ${
              activeBox === "message"
                ? "border-2 border-indigo-400 shadow-xl"
                : "border border-purple-100 hover:border-indigo-200"
            }`}
          >
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-gray-700">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              Mensagem
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[130px] border-gray-200 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-gray-300"
              placeholder={buildSuggestedMessage(triggerId, triggerValue)}
            />
            <p className="mt-2 text-xs text-gray-500">
              Sugestao baseada no trigger atual: {buildSuggestedMessage(triggerId, triggerValue)}
            </p>
          </motion.div>

          <FlowConnector />

          <motion.div
            onClick={() => setActiveBox("action")}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={`rounded-2xl bg-white p-6 shadow-lg transition-all cursor-pointer ${
              activeBox === "action"
                ? "border-2 border-indigo-400 shadow-xl"
                : "border border-purple-100 hover:border-indigo-200"
            }`}
          >
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-medium text-gray-700">
              <Bot className="h-4 w-4" />
              Action
            </div>
            <p className="mb-4 text-sm text-gray-600">Salvar automacao para executar a notificacao automaticamente.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveAutomation}>Salvar automacao</Button>
              <Button variant="outline" onClick={() => setIsCreating(false)}>
                Cancelar
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
