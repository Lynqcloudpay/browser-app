import { useState } from 'react';
import { api } from '../../api';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { Section } from '../../components/Section';
import { useToast } from '../../components/Toasts';
import { navigate } from '../../hooks/useRoute';
import type { ChannelView } from '../../types';

export function DangerSection({ channel }: { channel: ChannelView }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${channel.name}?`,
      body: 'This removes the channel from the studio. Videos already posted to TikTok or YouTube stay there.',
      confirmLabel: 'Delete channel',
      tone: 'destructive',
      requireText: channel.name,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteChannel(channel.id);
      toast.success(`Deleted ${channel.name}.`);
      navigate('#/');
    } catch (err) {
      toast.failure(err);
      setDeleting(false);
    }
  };

  return (
    <Section title="Danger zone" description="Deleting a channel removes it from the studio. This cannot be undone.">
      <div>
        <Button variant="destructive" busy={deleting} onClick={() => void remove()}>
          Delete channel
        </Button>
      </div>
      {dialog}
    </Section>
  );
}
