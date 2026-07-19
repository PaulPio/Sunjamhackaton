import dynamic from 'next/dynamic';
import Head from 'next/head';

const ControllerApp = dynamic(() => import('@/components/ControllerApp'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-full items-center justify-center bg-arena font-display tracking-widest text-neon">
      CONNECTING SWORD…
    </div>
  ),
});

export default function ControllerPage() {
  return (
    <>
      <Head>
        <title>DUEL LINK — Controller</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
      </Head>
      <ControllerApp />
    </>
  );
}
