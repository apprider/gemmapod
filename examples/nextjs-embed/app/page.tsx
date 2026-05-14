import { PodEmbed } from "./PodEmbed";

export default function Home() {
  return (
    <main>
      <h1>GemmaPod — Next.js embed</h1>
      <p className="lead">
        The widget below is mounted via <code>GemmaPod.mountPod</code> inside a
        client component. The IIFE is served from <code>/public/vendor/</code>
        (copied at build time from <code>@gemmapod/browser</code>).
      </p>

      <PodEmbed />

      <footer>
        Replace <code>signalUrl</code> and <code>podId</code> in
        <code>PodEmbed.tsx</code> to point at your own origin daemon.
      </footer>
    </main>
  );
}
