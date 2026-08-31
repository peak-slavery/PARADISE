import { Suspense } from 'react';

import { BotTabs } from '@/components/dashboard/BotTabs';
import { ConfigForm } from '@/components/dashboard/ConfigForm';
import { DEFAULT_BOT_ID, getBot, isBotId } from '@/lib/bots';
import { getBotConfig } from '@/lib/data/config';

export default async function GuildConfigPage({
  params,
  searchParams,
}: {
  params: { guildId: string };
  searchParams?: { tab?: string };
}) {
  const tabParam = searchParams?.tab;
  const botId = isBotId(tabParam) ? tabParam : DEFAULT_BOT_ID;
  const bot = getBot(botId);
  const { values, updatedAt, demo } = await getBotConfig(params.guildId, bot.id);

  return (
    <div className="pb-4">
      <div className="mb-5">
        <Suspense fallback={<TabsSkeleton />}>
          <BotTabs guildId={params.guildId} active={bot.id} />
        </Suspense>
      </div>

      <ConfigForm
        guildId={params.guildId}
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
