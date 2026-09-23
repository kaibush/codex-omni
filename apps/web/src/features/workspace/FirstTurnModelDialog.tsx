import { useEffect, useRef, useState } from "react";
import { Cpu, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { loadComposerModels, resolveComposerModel } from "@/lib/composer-selection";
import type { FirstTurnKind } from "@/lib/first-turn-model";
import type { Provider } from "@/types";

const copy: Record<FirstTurnKind, { title: string; description: string }> = {
  new: {
    title: "选择新建对话的模型",
    description: "这是新对话的第一条消息。确认供应商和模型后再发送，已填入默认值。"
  },
  fork: {
    title: "选择分叉对话的模型",
    description: "分叉后的第一条消息会在新会话里开始。确认供应商和模型后再发送，已填入默认值。"
  },
  continue: {
    title: "选择续接对话的模型",
    description: "续接会话的第一条消息会带上已有上下文。确认供应商和模型后再发送，已填入默认值。"
  }
};

function modelForProvider(provider: Provider | undefined, current: string) {
  return resolveComposerModel({
    current,
    available: provider?.models ?? [],
    preferred: provider ? (loadComposerModels()[provider.id] ?? null) : null,
    fallback: provider?.model ?? null
  });
}

export function FirstTurnModelDialog({
  open,
  kind,
  providers,
  providerId,
  model,
  busy,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  kind: FirstTurnKind | null;
  providers: Provider[];
  providerId: string;
  model: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (providerId: string, model: string) => void;
}) {
  const [selectedProviderId, setSelectedProviderId] = useState(providerId);
  const [selectedModel, setSelectedModel] = useState(model);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const touched = useRef(false);
  const openedAt = useRef(0);
  const providerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const models = selectedProvider?.models ?? [];
  const providerReady = Boolean(selectedProvider);
  const modelReady = Boolean(selectedModel && models.includes(selectedModel));
  const text = (kind && copy[kind]) || copy.new;

  useEffect(() => {
    if (!open) {
      touched.current = false;
      setConfirmArmed(false);
      return;
    }
    openedAt.current = Date.now();
    const timer = window.setTimeout(() => setConfirmArmed(true), 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      touched.current = false;
      return;
    }
    if (touched.current) return;
    const provider =
      providers.find((item) => item.id === providerId) ??
      providers.find((item) => item.isDefault) ??
      providers[0];
    setSelectedProviderId(provider?.id ?? "");
    setSelectedModel(modelForProvider(provider, model));
  }, [model, open, providerId, providers]);

  const chooseProvider = (id: string) => {
    const provider = providers.find((item) => item.id === id);
    touched.current = true;
    setSelectedProviderId(id);
    setSelectedModel(modelForProvider(provider, ""));
  };

  const ignoreOpeningGesture = (event: { preventDefault: () => void }) => {
    if (Date.now() - openedAt.current < 250) event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          providerTriggerRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={ignoreOpeningGesture}
        onInteractOutside={ignoreOpeningGesture}
      >
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{text.description}</DialogDescription>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">供应商</span>
            {providerReady ? (
              <Select value={selectedProviderId} onValueChange={chooseProvider} disabled={busy}>
                <SelectTrigger ref={providerTriggerRef} className="h-8 w-full rounded-lg">
                  <KeyRound className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder="选择供应商" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.isDefault ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-8 items-center rounded-lg border px-2.5 text-sm text-muted-foreground">
                还没有可用供应商
              </div>
            )}
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">模型</span>
            {modelReady ? (
              <Select
                value={selectedModel}
                onValueChange={(value) => {
                  touched.current = true;
                  setSelectedModel(value);
                }}
                disabled={busy}
              >
                <SelectTrigger className="h-8 w-full rounded-lg">
                  <Cpu className="size-3.5 text-muted-foreground" />
                  <SelectValue placeholder={selectedProvider?.model || "选择模型"} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                      {item === selectedProvider?.model ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-8 items-center rounded-lg border px-2.5 text-sm text-muted-foreground">
                使用供应商默认模型{selectedProvider?.model ? `：${selectedProvider.model}` : ""}
              </div>
            )}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            className="h-8 rounded-lg"
            disabled={busy || !confirmArmed || !selectedProviderId}
            onClick={() => onConfirm(selectedProviderId, selectedModel)}
          >
            使用该模型发送
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
