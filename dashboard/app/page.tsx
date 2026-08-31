import { ArchitectureSection } from '@/components/landing/ArchitectureSection';
import { BotShowcase } from '@/components/landing/BotShowcase';
import { CallToAction } from '@/components/landing/CallToAction';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { Hero } from '@/components/landing/Hero';
import { SiteFooter } from '@/components/landing/SiteFooter';
import { SiteHeader } from '@/components/landing/SiteHeader';

/**
 * Marketing landing page.
 *
 * Fully static — it touches no database, no cookies and no session, so it can
 * be prerendered at build time and served from the edge. Every dynamic piece
 * lives behind `/dashboard`.
 */
export const revalidate = 3600;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-base">
      <SiteHeader />
      <main>
        <Hero />
        <FeatureGrid />
        <BotShowcase />
        <ArchitectureSection />
        <CallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}
