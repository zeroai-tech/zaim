// Which shell is this running in?
//
// The same Next app serves two products: a website at zaim.zeroaitech.tech and
// a desktop application that boots this server on 127.0.0.1 and loads it in a
// native window. They need different first screens, and until now both got the
// website's: opening the desktop app signed out showed a marketing page with a
// hero, a feature grid and a Download section linking to GitHub releases, to
// somebody who had already downloaded and installed it.
//
// Detected from the user agent rather than an environment variable, because
// NEXT_PUBLIC_* values are inlined at build time and this has to be true at
// runtime for one build shared by both. Electron puts "Electron/<version>" in
// its UA and nothing else does.
//
// Server-side this is false, which is the safe default: the website is the
// public artefact, and rendering it in a desktop window is a cosmetic fault
// where the reverse would hide the sign-in from every web visitor.

export function isDesktop(): boolean {
  if (typeof navigator === 'undefined') return false
  return /\bElectron\//i.test(navigator.userAgent)
}
