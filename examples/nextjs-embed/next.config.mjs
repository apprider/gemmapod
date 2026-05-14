/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The shim IIFE expects to run in the browser. We don't need any special
  // config — just drop it into /public via the prebuild script and load it
  // through next/script.
};
