import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import type { TOCItemType } from "fumadocs-core/server";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/mdx-components";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";

// fumadocs-mdx puts a compiled MDX component on `data.body` plus a TOC
// array on `data.toc`. The loader's generic PageData type doesn't surface
// those statically, so we extract them with a narrow cast.
interface MDXPageData {
  body: (props: { components?: MDXComponents }) => ReactNode;
  toc?: TOCItemType[];
  full?: boolean;
  title: string;
  description?: string;
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const data = page.data as unknown as MDXPageData;
  const MDX = data.body;

  return (
    <DocsPage toc={data.toc ?? []} full={data.full}>
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
  };
}
