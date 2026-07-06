export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  pixelFormat: string | null;
  bitrateBps: number | null;
  /**
   * Длительность именно видеопотока (может быть короче контейнера, если
   * видео оборвалось, а аудио дописалось), null когда неизвестна.
   */
  durationSec: number | null;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRateHz: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitrateBps: number | null;
}

export interface MediaInfo {
  path: string;
  /** Container format as reported by ffprobe, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  container: string;
  durationSec: number | null;
  sizeBytes: number | null;
  bitrateBps: number | null;
  /** Primary (first) video stream, if any. */
  video: VideoStreamInfo | null;
  /** Primary (first) audio stream, if any. */
  audio: AudioStreamInfo | null;
  videoStreamCount: number;
  audioStreamCount: number;
}
