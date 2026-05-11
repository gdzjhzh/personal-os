import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createProductTeardown,
  getProductTeardownsByDate,
} from "@/lib/server/store";
import type { ProductTeardown, ProductTeardownSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductTeardownsPageProps = {
  searchParams?: Promise<{
    created?: string;
  }>;
};

const productTeardownSources: ProductTeardownSource[] = [
  "TrustMRR",
  "Toolify",
  "TAAFT",
  "Other",
];

export default async function ProductTeardownsPage({
  searchParams,
}: ProductTeardownsPageProps) {
  const params = await searchParams;
  const today = getTodayDate();
  const productTeardowns = await getProductTeardownsByDate(today);
  const progress = Math.min(productTeardowns.length, 3);

  return (
    <main className="min-h-screen bg-[#080908] px-3 py-4 font-sans text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-[1280px] gap-4">
        <header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              className="text-sm text-emerald-300 hover:text-emerald-200"
              href="/today"
            >
              返回今日任务跟踪
            </Link>
            <p className="mt-3 font-mono text-xs text-emerald-400">
              Personal SaaS OS · 产品判断训练
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-50 sm:text-3xl">
              今日 3 个产品拆解
            </h1>
          </div>
          <div className="text-sm leading-6 text-zinc-500 md:text-right">
            <div>日期：{today}</div>
            <div>今日进度：{progress}/3</div>
          </div>
        </header>

        {params?.created === "product-teardown" ? (
          <Notice>产品拆解已保存。</Notice>
        ) : null}

        <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <SectionTitle eyebrow="01" title="今日进度" />
            <Badge>{progress}/3</Badge>
          </div>
          {progress < 3 ? (
            <div className="border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              今天还没有完成 3 个产品拆解。不要刷信息，只记录 3 个。
            </div>
          ) : (
            <p className="text-sm text-emerald-300">今天已完成 3 个产品拆解。</p>
          )}
        </section>

        <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3">
          <SectionTitle eyebrow="02" title="新增产品拆解" />
          <form action={createProductTeardownAction} className="grid gap-3">
            <input type="hidden" name="date" value={today} />
            <div className="grid gap-2 md:grid-cols-[1.2fr_1.4fr_10rem]">
              <Field label="产品名称">
                <input
                  className={inputClassName}
                  name="productName"
                  placeholder="例如：TinyStart"
                  required
                />
              </Field>
              <Field label="产品链接">
                <input
                  className={inputClassName}
                  name="productUrl"
                  placeholder="可选"
                />
              </Field>
              <Field label="来源">
                <select
                  className={inputClassName}
                  name="source"
                  defaultValue="TrustMRR"
                >
                  {productTeardownSources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <Field label="解决的问题">
                <textarea className={compactTextareaClassName} name="problem" />
              </Field>
              <Field label="用户是谁">
                <textarea className={compactTextareaClassName} name="targetUser" />
              </Field>
              <Field label="用户为什么需要">
                <textarea
                  className={compactTextareaClassName}
                  name="whyUsersNeedIt"
                />
              </Field>
              <Field label="用户评价">
                <textarea
                  className={compactTextareaClassName}
                  name="userReviews"
                />
              </Field>
              <Field label="如何找到用户">
                <textarea
                  className={compactTextareaClassName}
                  name="acquisition"
                />
              </Field>
              <Field label="收入信号">
                <textarea
                  className={compactTextareaClassName}
                  name="revenueSignal"
                />
              </Field>
              <Field label="我学到了什么">
                <textarea
                  className={compactTextareaClassName}
                  name="whatILearned"
                />
              </Field>
              <Field label="什么做法不容易">
                <textarea className={compactTextareaClassName} name="hardPart" />
              </Field>
              <Field label="一句话推销">
                <textarea
                  className={compactTextareaClassName}
                  name="oneSentencePitch"
                />
              </Field>
              <Field label="不同的方法">
                <textarea
                  className={compactTextareaClassName}
                  name="alternativeApproach"
                />
              </Field>
              <Field label="我能做出来吗">
                <textarea
                  className={compactTextareaClassName}
                  name="canIBuildIt"
                />
              </Field>
              <Field label="冷启动策略">
                <textarea
                  className={compactTextareaClassName}
                  name="coldStartStrategy"
                />
              </Field>
              <Field label="备注">
                <textarea className={compactTextareaClassName} name="notes" />
              </Field>
            </div>

            <div className="flex justify-end">
              <button className={primaryButtonClassName} type="submit">
                保存产品拆解
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
          <SectionTitle eyebrow="03" title="今日记录" />
          {productTeardowns.length > 0 ? (
            <div className="grid gap-2 xl:grid-cols-3">
              {productTeardowns.map((teardown) => (
                <ProductTeardownCard key={teardown.id} teardown={teardown} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">今天还没有产品拆解记录。</p>
          )}
        </section>
      </div>
    </main>
  );
}

function ProductTeardownCard({ teardown }: { teardown: ProductTeardown }) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3 text-sm text-zinc-300">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-100">
            {teardown.productName}
          </h2>
          <span className="border border-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">
            {teardown.source}
          </span>
        </div>
        {teardown.productUrl ? (
          <a
            className="break-all text-xs text-emerald-300 hover:text-emerald-200"
            href={teardown.productUrl}
            rel="noreferrer"
            target="_blank"
          >
            {teardown.productUrl}
          </a>
        ) : null}
      </div>

      <dl className="grid gap-2">
        <ProductTeardownDetail label="解决的问题" value={teardown.problem} />
        <ProductTeardownDetail label="用户是谁" value={teardown.targetUser} />
        <ProductTeardownDetail
          label="用户为什么需要"
          value={teardown.whyUsersNeedIt}
        />
        <ProductTeardownDetail label="用户评价" value={teardown.userReviews} />
        <ProductTeardownDetail label="如何找到用户" value={teardown.acquisition} />
        <ProductTeardownDetail label="收入信号" value={teardown.revenueSignal} />
        <ProductTeardownDetail label="我学到了什么" value={teardown.whatILearned} />
        <ProductTeardownDetail label="什么做法不容易" value={teardown.hardPart} />
        <ProductTeardownDetail
          label="一句话推销"
          value={teardown.oneSentencePitch}
        />
        <ProductTeardownDetail
          label="不同的方法"
          value={teardown.alternativeApproach}
        />
        <ProductTeardownDetail label="我能做出来吗" value={teardown.canIBuildIt} />
        <ProductTeardownDetail
          label="冷启动策略"
          value={teardown.coldStartStrategy}
        />
        {teardown.notes ? (
          <ProductTeardownDetail label="备注" value={teardown.notes} />
        ) : null}
      </dl>
    </article>
  );
}

function ProductTeardownDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words leading-6 text-zinc-300">{value || "未填写"}</dd>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-emerald-400">{eyebrow}</span>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex border border-emerald-700 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300">
      {children}
    </span>
  );
}

async function createProductTeardownAction(formData: FormData) {
  "use server";

  const productName = getFormValue(formData, "productName").trim();

  if (!productName) {
    return;
  }

  await createProductTeardown({
    date: getFormValue(formData, "date") || getTodayDate(),
    productName,
    productUrl: getFormValue(formData, "productUrl"),
    source: parseProductTeardownSource(getFormValue(formData, "source")),
    problem: getFormValue(formData, "problem"),
    targetUser: getFormValue(formData, "targetUser"),
    whyUsersNeedIt: getFormValue(formData, "whyUsersNeedIt"),
    userReviews: getFormValue(formData, "userReviews"),
    acquisition: getFormValue(formData, "acquisition"),
    revenueSignal: getFormValue(formData, "revenueSignal"),
    whatILearned: getFormValue(formData, "whatILearned"),
    hardPart: getFormValue(formData, "hardPart"),
    oneSentencePitch: getFormValue(formData, "oneSentencePitch"),
    alternativeApproach: getFormValue(formData, "alternativeApproach"),
    canIBuildIt: getFormValue(formData, "canIBuildIt"),
    coldStartStrategy: getFormValue(formData, "coldStartStrategy"),
    notes: getFormValue(formData, "notes"),
  });

  revalidatePath("/today");
  revalidatePath("/today/product-teardowns");
  redirect("/today/product-teardowns?created=product-teardown");
}

function parseProductTeardownSource(value: string): ProductTeardownSource {
  const source = value as ProductTeardownSource;

  return productTeardownSources.includes(source) ? source : "Other";
}

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) || "");
}

function getTodayDate() {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const inputClassName =
  "border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const compactTextareaClassName =
  "min-h-20 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const primaryButtonClassName =
  "border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400";
