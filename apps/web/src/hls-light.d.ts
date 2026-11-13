// The light build of hls.js (no subtitles, no DRM) has the types of the full one.
declare module 'hls.js/light' {
  import Hls from 'hls.js';
  export default Hls;
}
