import * as Dialog from "@radix-ui/react-dialog";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Slider from "@radix-ui/react-slider";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Check,
  CircleAlert,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  Pin,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  APP_SHORTCUTS,
  FIXED_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  normalizeKeyName,
  shortcutFromKeyboardEvent,
  validateShortcut,
} from "../lib/keybindings";
import { cn } from "../lib/utils";
import {
  DEFAULT_SETTINGS,
  type Accent,
  type AppSettings,
  type AppShortcutId,
  type GlobalShortcutId,
  type ThemeMode,
} from "../types";
import { Button } from "./ui/button";
import { Shortcut } from "./ui/shortcut";

type RecorderTarget =
  | { scope: "global"; id: GlobalShortcutId; label: string }
  | { scope: "app"; id: AppShortcutId; label: string };

const accents: { id: Accent; label: string; color: string }[] = [
  { id: "blue", label: "Blue", color: "#287bd9" },
  { id: "teal", label: "Teal", color: "#148b88" },
  { id: "violet", label: "Violet", color: "#7857c6" },
  { id: "amber", label: "Amber", color: "#b66b16" },
  { id: "rose", label: "Rose", color: "#bc5269" },
];

function SettingHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted-text)]">
        {title}
      </h3>
      <p className="mt-1 text-[11px] leading-4 text-[var(--subtle)]">{description}</p>
    </div>
  );
}

function ShortcutRow({
  label,
  description,
  value,
  onRecord,
}: {
  label: string;
  description: string;
  value: string | null;
  onRecord: () => void;
}) {
  return (
    <button
      className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      onClick={onRecord}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-[var(--text)]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-[var(--subtle)]">
          {description}
        </span>
      </span>
      <Shortcut value={value} className="shrink-0" />
    </button>
  );
}

function ShortcutRecorder({
  target,
  settings,
  onClose,
  onSave,
  onUnset,
  onReset,
}: {
  target: RecorderTarget | null;
  settings: AppSettings;
  onClose: () => void;
  onSave: (value: string) => void;
  onUnset: () => void;
  onReset: () => void;
}) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastModifier = useRef<{ key: string; at: number } | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);

  const currentValue = target
    ? target.scope === "global"
      ? settings.globalShortcuts[target.id]
      : settings.appShortcuts[target.id]
    : null;

  function propose(value: string) {
    if (!target) return;
    setCandidate(value);
    setError(validateShortcut(value, target.scope, target.id, settings));
  }

  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[120] bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content
          ref={recorderRef}
          className="dialog-content fixed left-1/2 top-1/2 z-[121] w-[calc(100%-30px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-[var(--border)] bg-[var(--popover)] p-5 text-[var(--text)] shadow-[var(--shadow-dialog)] outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            recorderRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") return onClose();
            const key = normalizeKeyName(event.key);
            setPressed((current) => Array.from(new Set([...current, key])));
            const value = shortcutFromKeyboardEvent(event.nativeEvent);
            if (value) propose(value);
          }}
          onKeyUp={(event) => {
            if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            const key = normalizeKeyName(event.key);
            setPressed((current) => current.filter((item) => item !== key));
            if (!["Ctrl", "Alt", "Shift", "Win"].includes(key)) return;
            const previous = lastModifier.current;
            const at = performance.now();
            if (previous?.key === key && at - previous.at <= 440) {
              propose(`DoubleTap:${key}`);
              lastModifier.current = null;
            } else {
              lastModifier.current = { key, at };
            }
          }}
          tabIndex={-1}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Record shortcut</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-[var(--muted-text)]">
                Press the keys for{" "}
                <span className="font-medium text-[var(--text)]">{target?.label}</span>. Double-tap
                Ctrl, Alt, or Shift for a modifier-only global shortcut.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-lg p-1.5 text-[var(--subtle)] outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="Cancel recording"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div
            className={cn(
              "mt-5 flex min-h-20 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--muted)] px-4",
              error && "border-[var(--danger)] bg-[var(--danger-soft)]",
            )}
          >
            {candidate ? (
              <Shortcut value={candidate} />
            ) : pressed.length ? (
              <Shortcut value={pressed.join("+")} />
            ) : (
              <span className="text-xs text-[var(--subtle)]">Waiting for keys…</span>
            )}
          </div>
          {error ? (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-[var(--danger)]">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-[var(--subtle)]">Escape cancels without saving.</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset
            </Button>
            <Button variant="ghost" size="sm" onClick={onUnset}>
              Unset
            </Button>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!candidate || Boolean(error)}
              onClick={() => candidate && onSave(candidate)}
            >
              Confirm
            </Button>
          </div>
          {currentValue ? (
            <div className="mt-3 border-t border-[var(--border-soft)] pt-3 text-[10px] text-[var(--subtle)]">
              Current: <Shortcut value={currentValue} className="ml-1 align-middle" />
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsDialog({
  open,
  initialTab,
  settings,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  initialTab: "appearance" | "keybindings";
  settings: AppSettings;
  onOpenChange: (open: boolean) => void;
  onChange: (settings: AppSettings) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [recorder, setRecorder] = useState<RecorderTarget | null>(null);

  const recorderDefault = useMemo(() => {
    if (!recorder) return null;
    return recorder.scope === "global"
      ? DEFAULT_SETTINGS.globalShortcuts[recorder.id]
      : DEFAULT_SETTINGS.appShortcuts[recorder.id];
  }, [recorder]);

  function setAppearance(patch: Partial<AppSettings["appearance"]>) {
    onChange({ ...settings, appearance: { ...settings.appearance, ...patch } });
  }

  function saveRecorder(value: string | null) {
    if (!recorder) return;
    if (recorder.scope === "global") {
      onChange({
        ...settings,
        globalShortcuts: { ...settings.globalShortcuts, [recorder.id]: value },
      });
    } else {
      onChange({
        ...settings,
        appShortcuts: { ...settings.appShortcuts, [recorder.id]: value },
      });
    }
    setRecorder(null);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[95] bg-black/15 backdrop-blur-[1px]" />
          <Dialog.Content className="settings-panel fixed inset-[8px] z-[96] flex flex-col overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--panel-solid)] text-[var(--text)] shadow-[var(--shadow-dialog)] outline-none">
            <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
              <div>
                <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
                <Dialog.Description className="text-[10px] text-[var(--subtle)]">
                  Changes apply immediately and stay on this device.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  className="rounded-lg p-2 text-[var(--subtle)] outline-none hover:bg-[var(--muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  aria-label="Close settings"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>

            <Tabs.Root
              value={tab}
              onValueChange={(value) => setTab(value as typeof tab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Tabs.List
                className="mx-4 mt-3 grid grid-cols-2 rounded-xl bg-[var(--muted)] p-1"
                aria-label="Settings sections"
              >
                <Tabs.Trigger
                  value="appearance"
                  className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-[var(--muted-text)] outline-none transition-colors data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--text)] data-[state=active]:shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Palette className="size-3.5" /> Appearance
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="keybindings"
                  className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-[var(--muted-text)] outline-none transition-colors data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--text)] data-[state=active]:shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <Keyboard className="size-3.5" /> Keybindings
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content
                value="appearance"
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-5 outline-none"
              >
                <SettingHeader
                  title="Theme"
                  description="Follow Windows, or keep Cairn in one mode."
                />
                <RadioGroup.Root
                  value={settings.appearance.theme}
                  onValueChange={(value) => setAppearance({ theme: value as ThemeMode })}
                  className="grid grid-cols-3 gap-2"
                >
                  {(
                    [
                      ["light", Sun, "Light"],
                      ["dark", Moon, "Dark"],
                      ["system", Monitor, "System"],
                    ] as const
                  ).map(([value, Icon, label]) => (
                    <RadioGroup.Item
                      key={value}
                      value={value}
                      className="group flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--muted-text)] outline-none data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent-soft)] data-[state=checked]:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <Icon className="size-4" />
                      <span className="text-[10px] font-medium">{label}</span>
                    </RadioGroup.Item>
                  ))}
                </RadioGroup.Root>

                <div className="mt-6">
                  <SettingHeader
                    title="Background opacity"
                    description="Keep text crisp while letting context show through."
                  />
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <div className="mb-3 flex items-center justify-between text-xs">
                      <span className="text-[var(--muted-text)]">Rail background</span>
                      <span className="font-medium tabular-nums">
                        {settings.appearance.opacity}%
                      </span>
                    </div>
                    <Slider.Root
                      value={[settings.appearance.opacity]}
                      min={72}
                      max={100}
                      step={1}
                      onValueChange={([opacity]) => setAppearance({ opacity })}
                      className="relative flex h-5 touch-none select-none items-center"
                    >
                      <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-[var(--muted-strong)]">
                        <Slider.Range className="absolute h-full bg-[var(--accent)]" />
                      </Slider.Track>
                      <Slider.Thumb className="block size-4 rounded-full border-2 border-[var(--accent)] bg-[var(--panel-solid)] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]" />
                    </Slider.Root>
                  </div>
                </div>

                <div className="mt-6">
                  <SettingHeader
                    title="Accent"
                    description="A restrained highlight for selection and focus."
                  />
                  <RadioGroup.Root
                    value={settings.appearance.accent}
                    onValueChange={(value) => setAppearance({ accent: value as Accent })}
                    className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
                  >
                    {accents.map((accent) => (
                      <RadioGroup.Item
                        key={accent.id}
                        value={accent.id}
                        className="flex size-9 items-center justify-center rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
                        aria-label={accent.label}
                      >
                        <span
                          className="flex size-6 items-center justify-center rounded-full"
                          style={{ background: accent.color }}
                        >
                          {settings.appearance.accent === accent.id ? (
                            <Check className="size-3.5 text-white" strokeWidth={3} />
                          ) : null}
                        </span>
                      </RadioGroup.Item>
                    ))}
                  </RadioGroup.Root>
                </div>

                <div className="mt-6 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <Pin className="size-4 text-[var(--subtle)]" />
                    <div>
                      <div className="text-xs font-medium">Always on top</div>
                      <div className="text-[10px] text-[var(--subtle)]">
                        Keep the rail above other windows.
                      </div>
                    </div>
                  </div>
                  <Switch.Root
                    checked={settings.alwaysOnTop}
                    onCheckedChange={(alwaysOnTop) => onChange({ ...settings, alwaysOnTop })}
                    className="relative h-5 w-9 rounded-full bg-[var(--muted-strong)] outline-none data-[state=checked]:bg-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
                  </Switch.Root>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-5 w-full text-[var(--muted-text)]"
                  onClick={() =>
                    onChange({
                      ...settings,
                      appearance: structuredClone(DEFAULT_SETTINGS.appearance),
                      alwaysOnTop: DEFAULT_SETTINGS.alwaysOnTop,
                    })
                  }
                >
                  <RotateCcw className="mr-2 size-3.5" /> Restore default appearance
                </Button>
              </Tabs.Content>

              <Tabs.Content
                value="keybindings"
                className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-5 outline-none"
              >
                <div className="px-1">
                  <SettingHeader
                    title="Global shortcuts"
                    description="Work from any Windows app. Changes take effect immediately."
                  />
                </div>
                <div className="divide-y divide-[var(--border-soft)] rounded-xl border border-[var(--border)] bg-[var(--card)] p-1">
                  {GLOBAL_SHORTCUTS.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.id}
                      {...shortcut}
                      value={settings.globalShortcuts[shortcut.id]}
                      onRecord={() =>
                        setRecorder({ scope: "global", id: shortcut.id, label: shortcut.label })
                      }
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-6 mt-2 w-full text-[var(--muted-text)]"
                  onClick={() =>
                    onChange({
                      ...settings,
                      globalShortcuts: structuredClone(DEFAULT_SETTINGS.globalShortcuts),
                    })
                  }
                >
                  <RotateCcw className="mr-2 size-3.5" /> Restore global defaults
                </Button>

                <div className="px-1">
                  <SettingHeader
                    title="Cairn commands"
                    description="Customizable commands used while the rail has focus."
                  />
                </div>
                <div className="divide-y divide-[var(--border-soft)] rounded-xl border border-[var(--border)] bg-[var(--card)] p-1">
                  {APP_SHORTCUTS.map((shortcut) => (
                    <ShortcutRow
                      key={shortcut.id}
                      {...shortcut}
                      value={settings.appShortcuts[shortcut.id]}
                      onRecord={() =>
                        setRecorder({ scope: "app", id: shortcut.id, label: shortcut.label })
                      }
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-6 mt-2 w-full text-[var(--muted-text)]"
                  onClick={() =>
                    onChange({
                      ...settings,
                      appShortcuts: structuredClone(DEFAULT_SETTINGS.appShortcuts),
                    })
                  }
                >
                  <RotateCcw className="mr-2 size-3.5" /> Restore Cairn defaults
                </Button>

                <div className="px-1">
                  <SettingHeader
                    title="Standard editing"
                    description="Read-only shortcuts stay consistent with Windows apps."
                  />
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
                  {FIXED_SHORTCUTS.map(([shortcut, label]) => (
                    <div
                      key={shortcut}
                      className="flex items-center justify-between gap-3 px-2 py-1.5"
                    >
                      <span className="text-[11px] text-[var(--muted-text)]">{label}</span>
                      <Shortcut value={shortcut} className="shrink-0" />
                    </div>
                  ))}
                </div>
              </Tabs.Content>
            </Tabs.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ShortcutRecorder
        key={recorder ? `${recorder.scope}:${recorder.id}` : "closed"}
        target={recorder}
        settings={settings}
        onClose={() => setRecorder(null)}
        onSave={saveRecorder}
        onUnset={() => saveRecorder(null)}
        onReset={() => saveRecorder(recorderDefault)}
      />
    </>
  );
}
