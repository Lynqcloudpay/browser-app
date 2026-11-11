import { useState } from 'react';
import { Search } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Button } from '../../components/Button';
import { Section } from '../../components/Section';
import { useToast } from '../../components/Toasts';
import type { ChannelView } from '../../types';
import type { PatchFn } from './ChannelHeader';

type Msg = { tone: 'info' | 'success' | 'error'; text: string };

const TONE: Record<Msg['tone'], string> = {
  info: 'text-ink-soft',
  success: 'text-leaf-ink',
  error: 'text-apple-deep',
};

export function ChatGptSection({ channel, patch }: { channel: ChannelView; patch: PatchFn }) {
  const toast = useToast();
  const [url, setUrl] = useState(channel.chatgpt_chat_url);
  const [chatName, setChatName] = useState(channel.chatgpt_chat_name);
  const [hashtag, setHashtag] = useState(channel.hashtag_hint);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const save = async () => {
    setMsg(null);
    setSaving(true);
    try {
      await patch({ chatgpt_chat_url: url.trim(), chatgpt_chat_name: chatName.trim(), hashtag_hint: hashtag.trim() });
      setMsg({ tone: 'success', text: 'ChatGPT settings saved.' });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
      toast.failure(err);
    } finally {
      setSaving(false);
    }
  };

  const detect = async () => {
    setDetecting(true);
    setMsg({ tone: 'info', text: 'Opening ChatGPT in your browser to find the chat...' });
    try {
      const result = await api.detectChatGptUrl(channel.id);
      if (result.success && result.url) {
        setUrl(result.url);
        setMsg({ tone: 'success', text: `Found "${result.title || result.url}". Save to keep it.` });
      } else {
        setMsg({ tone: 'error', text: result.message || 'Could not find the conversation in your sidebar.' });
      }
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Section
      title="ChatGPT prompt chat"
      description={<>Each run opens this chat and sends "next". ChatGPT replies with the next video prompt.</>}
    >
      <div>
        <label htmlFor="chatgpt-url" className="mb-1.5 block text-[14px] font-semibold">
          Conversation link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="chatgpt-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://chatgpt.com/c/..."
            className="min-w-0 flex-1 rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
          />
          <div className="flex gap-2">
            <Button onClick={() => void save()} busy={saving}>
              Save
            </Button>
            <Button busy={detecting} onClick={() => void detect()} icon={<Search className="size-4" aria-hidden="true" />}>
              Auto-detect from sidebar
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="chatgpt-name" className="mb-1.5 block text-[14px] font-semibold">
            Chat name in sidebar (optional)
          </label>
          <input
            id="chatgpt-name"
            type="text"
            value={chatName}
            onChange={(e) => setChatName(e.target.value)}
            placeholder="For example, Create Mr Apple Videos"
            className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
          />
        </div>
        <div>
          <label htmlFor="hashtag-hint" className="mb-1.5 block text-[14px] font-semibold">
            Hashtag hint
          </label>
          <input
            id="hashtag-hint"
            type="text"
            value={hashtag}
            onChange={(e) => setHashtag(e.target.value)}
            placeholder="#MyCharacter"
            className="w-full rounded-[10px] border border-ink-soft bg-sheet px-3 py-2 text-[15px]"
          />
        </div>
      </div>

      {msg && (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`text-[14px] font-medium ${TONE[msg.tone]}`}>
          {msg.text}
        </p>
      )}
    </Section>
  );
}
