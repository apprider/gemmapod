import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <span aria-hidden style={{ display: "inline-block", width: 16, height: 16, marginRight: 8, borderRadius: 4, background: "linear-gradient(135deg, #58a6ff, #bc8cff)", verticalAlign: "-3px" }} />
        <span style={{ fontWeight: 600 }}>GemmaPod</span>
        <span style={{ fontSize: 11, marginLeft: 8, padding: "2px 6px", borderRadius: 4, background: "var(--color-fd-muted)", color: "var(--color-fd-muted-foreground)" }}>
          docs
        </span>
      </>
    ),
  },
  links: [
    { text: "Docs", url: "/docs", active: "nested-url" },
    { text: "Examples", url: "https://github.com/apprider/gemmapod/tree/main/examples", external: true },
    { text: "Changelog", url: "/docs/changelog" },
    { text: "GitHub", url: "https://github.com/apprider/gemmapod", external: true },
  ],
};
