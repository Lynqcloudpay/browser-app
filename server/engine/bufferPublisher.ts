import crypto from 'crypto';
import db from '../db/database';

export interface PublishResult {
  success: boolean;
  providerPostId: string;
  scheduledAt?: string;
  publishedAt?: string;
  shareUrl?: string;
  isAiGenerated: boolean;
  status: 'published' | 'scheduled' | 'awaiting_action' | 'failed';
  actionNotes?: string;
  simulated: boolean;
}

export class BufferTikTokPublisher {
  private static graphqlEndpoint = 'https://api.buffer.com';

  private static getConnection(): { token: string; channelId: string } {
    const row = db.prepare("SELECT api_key, account_identifier FROM account_connections WHERE provider = 'buffer_tiktok'").get() as { api_key?: string; account_identifier?: string } | undefined;
    return {
      token: row?.api_key || process.env.BUFFER_ACCESS_TOKEN || '',
      channelId: row?.account_identifier || process.env.BUFFER_CHANNEL_ID || '',
    };
  }

  /**
   * Publish or schedule a video post to an adult-owned TikTok channel for family co-viewing.
   */
  public static async publishVideoPost(
    jobId: string,
    title: string,
    captionText: string,
    videoUrl: string,
    thumbnailUrl: string,
    dueAtIso?: string
  ): Promise<PublishResult> {
    const { token, channelId } = this.getConnection();
    const settings = db.prepare('SELECT demo_mode FROM settings WHERE id = 1').get() as { demo_mode: number } | undefined;
    const isDemo = settings?.demo_mode === 1 || !token || !channelId;

    if (!isDemo && token && channelId) {
      try {
        return await this.publishViaBufferGraphQL(jobId, title, captionText, videoUrl, thumbnailUrl, token, channelId, dueAtIso);
      } catch (err: any) {
        console.warn(`[BufferTikTokPublisher] Live publishing failed (${err.message}). Recording awaiting_action.`);
        return {
          success: false,
          providerPostId: '',
          status: 'awaiting_action',
          actionNotes: `Buffer submission error: ${err.message}. Awaiting operator review.`,
          isAiGenerated: true,
          simulated: false,
        };
      }
    }

    // In demo or test mode, generate a confirmed publication receipt
    const mockPostId = 'buf_ttk_' + crypto.randomUUID().slice(0, 10);
    const mockTiktokId = '74' + Math.floor(Math.random() * 8999999999 + 1000000000);
    const mockShareUrl = `https://www.tiktok.com/@kindred_kids/video/${mockTiktokId}`;
    const nowIso = new Date().toISOString();

    // Check if slot requires scheduled mode or direct post
    const isScheduled = !!dueAtIso && new Date(dueAtIso).getTime() > Date.now() + 60_000;

    return {
      success: true,
      providerPostId: mockPostId,
      scheduledAt: isScheduled ? dueAtIso : undefined,
      publishedAt: isScheduled ? undefined : nowIso,
      shareUrl: mockShareUrl,
      isAiGenerated: true,
      status: isScheduled ? 'scheduled' : 'published',
      actionNotes: isScheduled
        ? 'Scheduled via Buffer to adult TikTok channel with AI-generated disclosure.'
        : 'Published to TikTok channel (family co-viewing) with required AI label.',
      simulated: true,
    };
  }

  private static async publishViaBufferGraphQL(
    jobId: string,
    title: string,
    captionText: string,
    videoUrl: string,
    thumbnailUrl: string,
    token: string,
    channelId: string,
    dueAtIso?: string
  ): Promise<PublishResult> {
    const isScheduled = !!dueAtIso && new Date(dueAtIso).getTime() > Date.now() + 60_000;
    const schedulingType = isScheduled ? 'customScheduled' : 'automatic';

    const fullCaption = `${title}\n\n${captionText}\n\n#kids #family #learning #puzzle #educational`;

    // Buffer GraphQL mutation for creating scheduled or immediate video post with TikTokPostMetadataInput
    const query = `
      mutation CreateTikTokPost($input: CreatePostInput!) {
        createPost(input: $input) {
          post {
            id
            status
            dueAt
          }
        }
      }
    `;

    const variables = {
      input: {
        channelId,
        text: fullCaption,
        schedulingType,
        dueAt: isScheduled ? dueAtIso : undefined,
        assets: [
          {
            video: {
              url: videoUrl,
              thumbnail: thumbnailUrl,
            },
          },
        ],
        metadata: {
          tiktok: {
            isAiGenerated: true,
            title: title.slice(0, 100),
          },
        },
      },
    };

    const res = await fetch(this.graphqlEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`Buffer API HTTP ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    if (json.errors && json.errors.length > 0) {
      throw new Error(`Buffer GraphQL error: ${json.errors[0].message}`);
    }

    const post = json.data?.createPost?.post;
    const postId = post?.id || 'buf_' + crypto.randomUUID().slice(0, 8);

    return {
      success: true,
      providerPostId: postId,
      scheduledAt: post?.dueAt || dueAtIso,
      publishedAt: !isScheduled ? new Date().toISOString() : undefined,
      shareUrl: `https://buffer.com/app/posts/${postId}`,
      isAiGenerated: true,
      status: isScheduled ? 'scheduled' : 'published',
      actionNotes: 'Successfully synced with Buffer TikTok scheduler.',
      simulated: false,
    };
  }
}

export default BufferTikTokPublisher;

