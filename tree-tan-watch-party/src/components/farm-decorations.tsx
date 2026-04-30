import Image from "next/image";

export function FarmDecorations() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <Image
        alt=""
        className="absolute left-2 top-24 h-auto w-20 opacity-95 drop-shadow-[0_10px_12px_rgba(0,0,0,0.2)] sm:w-24 lg:w-28"
        height={256}
        src="/chicken.png"
        width={256}
      />
      <Image
        alt=""
        className="absolute right-3 top-[5.5rem] hidden h-auto w-24 opacity-95 drop-shadow-[0_10px_12px_rgba(0,0,0,0.2)] sm:block lg:w-28"
        height={256}
        src="/duck.png"
        width={256}
      />
      <Image
        alt=""
        className="absolute bottom-2 left-4 h-auto w-24 opacity-95 drop-shadow-[0_12px_14px_rgba(0,0,0,0.22)] sm:w-28 lg:w-32"
        height={256}
        src="/cat.png"
        width={256}
      />
      <Image
        alt=""
        className="absolute bottom-2 right-4 h-auto w-24 opacity-95 drop-shadow-[0_12px_14px_rgba(0,0,0,0.22)] sm:w-28 lg:w-32"
        height={256}
        src="/cow.png"
        width={256}
      />
    </div>
  );
}
