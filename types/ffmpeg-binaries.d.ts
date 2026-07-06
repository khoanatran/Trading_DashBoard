declare module 'ffmpeg-static' {
  const path: string
  export default path
}

declare module 'ffprobe-static' {
  export const path: string
  const ffprobe: { path: string }
  export default ffprobe
}
