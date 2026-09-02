import { Suspense } from 'react';

import { BotTabs } from '@/components/dashboard/BotTabs';
import { ConfigForm } from '@/components/dashboard/ConfigForm';
import { ControlCenter } from '@/components/dashboard/ControlCenter';
import { requireGuildAccess } from '@/lib/authz';
import { DEFAULT_BOT_ID, getBot, isBotId } from '@/lib/bots';
import { getBotConfig } from '@/lib/data/config';

export default async function GuildConfigPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { guildId } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const tabParam = sp?.tab;
  const botId = isBotId(tabParam) ? tabParam : DEFAULT_BOT_ID;
  const bot = getBot(botId);
  // Authorize here, not only in the layout: Next renders layout and page
  // concurrently, so a layout-level notFound() does not stop this fetch.
  await requireGuildAccess(guildId);
  const { values, updatedAt, demo } = await getBotConfig(guildId, bot.id);

  return (
    <div className="pb-4">
      <div className="mb-5">
        <Suspense fallback={<TabsSkeleton />}>
          <BotTabs guildId={guildId} active={bot.id} />
        </Suspense>
      </div>

      <ControlCenter guildId={guildId} />

      <ConfigForm
        guildId={guildId}
        bot={bot}
        initialValues={values}
        updatedAt={updatedAt}
        demo={demo}
      />
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div className="rounded-3xl neu-inset p-2">
      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-11 w-32 shrink-0 rounded-2xl bg-base" />
        ))}
      </div>
    </div>
  );
}
