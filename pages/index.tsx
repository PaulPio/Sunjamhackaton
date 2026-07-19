import dynamic from 'next/dynamic';
import Head from 'next/head';

const ScreenDesktop = dynamic(() => import('@/components/ScreenDesktop'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-arena font-display tracking-widest text-neon">
      LOADING ARENA…
    </div>
  ),
});

export default function HomePage() {
  return (
    <>
      <Head>
        <title>DUEL LINK</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      <ScreenDesktop />
    </>
  );
}
