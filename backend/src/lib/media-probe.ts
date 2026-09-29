// Pre-submit media checks for the composer's public URLs (websitePlan.md
// §10.4-10.5): one cheap request per URL instead of N platform failures,
// and ffprobe for the YouTube Shorts shape check.

const URL_CHECK_TIMEOUT_MS = 8_000;
const FFPROBE_TIMEOUT_MS = 20_000;

export type ExpectedMedia = "image" | "video";

// Returns an error message, or null if the URL looks like the right kind of
// media. application/octet-stream passes — some object stores serve
// everything as that, and the platform will reject a truly wrong file anyway.
export async function checkMediaUrl(url: string, expected: ExpectedMedia): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
    });
    // Some hosts don't implement HEAD — ask for one byte instead.
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
      });
      await response.body?.cancel();
    }
  } catch {
    return `Couldn't reach ${url}`;
  }
  if (!response.ok) {
    return `${url} returned HTTP ${response.status}`;
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    contentType === "" ||
    contentType === "application/octet-stream" ||
    contentType.startsWith(`${expected}/`)
  ) {
    return null;
  }
  return `${url} is ${contentType}, not ${expected === "image" ? "an image" : "a video"}`;
}

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
