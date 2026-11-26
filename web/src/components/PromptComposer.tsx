import { AtSign, ImagePlus, Paperclip, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { WORKSPACE_AGENTS } from '../agents';
import type { ChatDraft, ChatImage } from '../types';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name.slice(0, 120) || '剪贴板图片', dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error('无法读取图片，请重新添加'));
    reader.readAsDataURL(file);
  });
}

interface Props {
  draft: ChatDraft;
  setDraft: Dispatch<SetStateAction<ChatDraft>>;
  onSend: (draft: ChatDraft) => void;
  disabled: boolean;
  variant: 'studio' | 'landing' | 'brainstorm';
  placeholder: string;
  ariaLabel?: string;
  footerTools?: ReactNode;
  renderSubmit: (disabled: boolean) => ReactNode;
}

export function PromptComposer({
  draft, setDraft, onSend, disabled, variant, placeholder, ariaLabel, footerTools, renderSubmit,
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<number | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const compact = variant !== 'landing';
  const meeting = variant === 'brainstorm';
  const AttachmentIcon = compact ? ImagePlus : Paperclip;

  const before = caret === null ? '' : draft.text.slice(0, caret);
  const mention = meeting ? null : /(?<![a-z0-9._%+@-])@([a-z]*)$/i.exec(before);
  const options = mention
    ? WORKSPACE_AGENTS.filter(({ name }) => name.toLowerCase().startsWith(mention[1].toLowerCase()))
    : [];
  const activeIndex = Math.min(highlighted, options.length - 1);
  const canSend = !disabled && !reading && Boolean(draft.text.trim() || draft.images.length);

  useLayoutEffect(() => {
    const position = pendingSelection.current;
    const input = textarea.current;
    if (position === null || !input) return;
    pendingSelection.current = null;
    input.focus();
    input.setSelectionRange(position, position);
  });

  function replaceText(start: number, end: number, value: string) {
    const next = draft.text.slice(0, start) + value + draft.text.slice(end);
    const position = start + value.length;
    pendingSelection.current = position;
    setDraft((current) => ({ ...current, text: next }));
    setCaret(position);
    setHighlighted(0);
  }

  function complete(name: string) {
    if (!mention || caret === null) return;
    const suffix = draft.text.slice(caret);
    const end = caret + (suffix.match(/^[a-z]+/i)?.[0].length ?? 0);
    replaceText(mention.index, end + Number(draft.text[end] === ' '), `@${name} `);
  }

  async function addImages(files: File[]) {
    if (!files.length || disabled || reading) return;
    setError('');
    if (files.length + draft.images.length > MAX_IMAGES) {
      setError('每条消息最多可发送 3 张图片');
      return;
    }
    if (files.some((file) => !IMAGE_TYPES.includes(file.type))) {
      setError('请选择 JPEG、PNG、GIF 或 WebP 图片');
      return;
    }
    if (files.some((file) => !file.size || file.size > MAX_IMAGE_BYTES)) {
      setError('单张图片必须大于 0，并且不能超过 2 MB');
      return;
    }
    setReading(true);
    try {
      const images = await Promise.all(files.map(readImage));
      setDraft((current) => ({ ...current, images: [...current.images, ...images] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取图片');
    } finally {
      setReading(false);
    }
  }

  return (
    <form
      className={compact ? 'relative' : 'relative dashboard-composer'}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          setCaret(null);
          setError('');
          onSend({ ...draft, text: draft.text.trim() });
        }
      }}
    >
      {draft.images.length > 0 && (
        <div className="composer-attachments flex flex-wrap gap-2 px-1 pb-2">
          {draft.images.map((image, index) => (
            <div key={`${index}-${image.name}`} className="relative">
              <img className="h-16 w-16 rounded-lg border border-zinc-700 object-cover" src={image.dataUrl} alt={image.name} />
              <button
                type="button"
                aria-label={`移除 ${image.name}`}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-full border border-zinc-700 bg-zinc-900 p-0.5 text-zinc-200 hover:bg-zinc-700"
                onClick={() => {
                  setDraft((current) => ({ ...current, images: current.images.filter((_, i) => i !== index) }));
                  setError('');
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textarea}
        value={draft.text}
        disabled={disabled}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        aria-label={ariaLabel ?? (compact ? '聊天消息' : '应用需求')}
        aria-autocomplete="list"
        aria-controls={options.length ? listId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        className={`w-full resize-none bg-transparent text-zinc-100 placeholder-zinc-500 focus:outline-none disabled:opacity-50 ${compact ? 'px-1.5 py-1 text-xs' : 'px-2 py-1.5 text-sm'}`}
        onChange={(event) => {
          const { value, selectionStart } = event.currentTarget;
          setDraft((current) => ({ ...current, text: value }));
          setCaret(selectionStart);
          setHighlighted(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onBlur={() => setCaret(null)}
        onPaste={(event) => {
          const images = Array.from(event.clipboardData.files);
          if (images.length) {
            event.preventDefault();
            void addImages(images);
          }
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (options.length) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              setHighlighted((activeIndex + direction + options.length) % options.length);
              return;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
              event.preventDefault();
              complete(options[activeIndex].name);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setCaret(null);
              return;
            }
          }
          if (event.key === 'Enter' && (compact ? !event.shiftKey : event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {options.length > 0 && (
        <div id={listId} role="listbox" aria-label="可提及成员" className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {options.map(({ name, role }, index) => (
            <div
              id={`${listId}-${index}`}
              key={name}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => complete(name)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs ${index === activeIndex ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-200'}`}
            >
              <span className="font-medium">@{name}</span>
              <span className="text-zinc-400">{role}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="px-1 text-xs text-rose-300">{error}</p>}
      <div className={`composer-footer flex items-center justify-between gap-2 ${compact ? 'mt-1.5' : 'border-t'}`}>
        <div className="flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={IMAGE_TYPES.join(',')}
            aria-label="上传图片"
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void addImages(files);
            }}
          />
          <button
            type="button"
            disabled={disabled || reading || draft.images.length >= MAX_IMAGES}
            title="添加图片（每张最大 2 MB）"
            aria-label="添加图片"
            className="composer-tool rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
            onClick={() => fileInput.current?.click()}
          >
            <AttachmentIcon className="h-4 w-4" />
          </button>
          {!meeting && <button
            type="button"
            disabled={disabled}
            aria-label="提及成员"
            title="提及成员"
            className="composer-tool rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
            onClick={() => {
              const start = textarea.current?.selectionStart ?? draft.text.length;
              const end = textarea.current?.selectionEnd ?? start;
              const separator = start > 0 && /[a-z0-9._%+@-]/i.test(draft.text[start - 1]) ? ' ' : '';
              replaceText(start, end, separator + '@');
            }}
          >
            <AtSign className="h-4 w-4" />
          </button>}
          {footerTools}
        </div>
        {renderSubmit(!canSend)}
      </div>
    </form>
  );
}
