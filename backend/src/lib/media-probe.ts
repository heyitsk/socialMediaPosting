// ffprobe for the YouTube Shorts shape check (websitePlan.md §10.5), run
// against a short-lived presigned S3 URL of the uploaded video.

const FFPROBE_TIMEOUT_MS = 20_000;

export interface VideoShape {
  width: number;
  height: number;
  durationSeconds: number;
}

interface FfprobeOutput {
  streams?: {
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  }[];
  format?: { duration?: string };
}

// Display width/height — phone videos are often stored landscape with a
// ±90° rotation flag, which players (and YouTube) apply before judging shape.
export async function probeVideo(url: string): Promise<VideoShape> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), FFPROBE_TIMEOUT_MS);
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    throw new Error("Couldn't read the video to check its dimensions");
  }

  const output = JSON.parse(stdout) as FfprobeOutput;
  const stream = output.streams?.[0];
  const duration = Number(output.format?.duration);
  if (!stream?.width || !stream.height || !Number.isFinite(duration)) {
    throw new Error("Couldn't find a video stream in that file");
  }

  const rotation =
    stream.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ??
    Number(stream.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90;
  return {
    width: sideways ? stream.height : stream.width,
    height: sideways ? stream.width : stream.height,
    durationSeconds: duration,
  };
}
