import Image from "next/image";

export function Brand({ light = false, className = "", width = 164 }: {
  light?: boolean;
  className?: string;
  width?: number;
}) {
  return <Image
    src={light ? "/brand/detali-light.svg" : "/brand/detali.svg"}
    alt="detali"
    width={460}
    height={140}
    priority
    className={`detali-logo ${className}`}
    style={{ width, maxWidth: "100%" }}
  />;
}
