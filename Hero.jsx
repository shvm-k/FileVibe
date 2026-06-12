export default function Hero() {
  return (
    <div className="min-h-screen bg-white text-black bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:24px_24px]">
      {/* NAVIGATION */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-6 border-b-[2px] border-black">
        <div className="text-2xl font-extrabold lowercase tracking-tight">
          shvm.
        </div>
        <div className="flex gap-2 font-mono text-sm lowercase">
          {["work", "about", "filevibe", "contact"].map((link) => (
            <a
              key={link}
              href={`#${link}`}
              className="px-3 py-1 transition-colors duration-150 hover:bg-[#FFE600] hover:text-black"
            >
              {link}
            </a>
          ))}
        </div>
      </nav>

      {/* HERO */}
      <section className="px-6 md:px-12 py-16 grid grid-cols-1 lg:grid-cols-2 gap-16">
        {/* LEFT COLUMN */}
        <div className="flex flex-col justify-center gap-8">
          {/* Tagline badge */}
          <div className="inline-flex items-center gap-2 self-start border-[2px] border-black px-4 py-2 text-xs md:text-sm font-mono uppercase tracking-widest">
            <span>⚡</span> FRONTEND CRAFT &amp; VISUAL UX
          </div>

          {/* Main Title */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black leading-[1.05] tracking-tight">
            I design landing pages and product interfaces that actually convert.
          </h1>

          {/* Subtitle */}
          <p className="text-base md:text-lg text-black/70 max-w-xl leading-relaxed">
            I'm{" "}
            <span className="relative inline-block font-semibold text-black">
              Nilabh Shivam
              <span className="absolute left-0 -bottom-0.5 w-full h-[2px] bg-[#FFE600]"></span>
            </span>
            , a creative developer crafting interfaces at the intersection of
            visual authority and frontend engineering. Currently{" "}
            <span className="relative inline-block font-semibold text-black">
              building FileVibe
              <span className="absolute left-0 -bottom-0.5 w-full h-[2px] bg-[#FFE600]"></span>
            </span>{" "}
            in public.
          </p>

          {/* Buttons */}
          <div className="flex flex-wrap gap-4 mt-2">
            <a
              href="#work"
              className="group relative px-6 py-3 border-[3px] border-black font-bold uppercase text-sm bg-white shadow-[4px_4px_0px_0px_#000] transition-all duration-100 hover:bg-[#FFE600] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]"
            >
              View My Work
            </a>
            <a
              href="#contact"
              className="group relative px-6 py-3 border-[3px] border-black font-bold uppercase text-sm bg-white shadow-[4px_4px_0px_0px_#000] transition-all duration-100 hover:bg-[#FFE600] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]"
            >
              Get In Touch
            </a>
          </div>
        </div>

        {/* RIGHT COLUMN - SYSTEM CARD */}
        <div className="flex items-center justify-center">
          <div className="w-full max-w-md border-[3px] border-black bg-white shadow-[8px_8px_0px_0px_#000]">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-black text-white font-mono text-xs uppercase tracking-widest">
              <span>SYS.STATUS // STACK_ALIGNED</span>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white animate-pulse"></span>
              </span>
            </div>

            {/* Body */}
            <div className="p-6 flex flex-col gap-4">
              {/* Box 1 */}
              <div className="border-[2px] border-black p-4">
                <p className="font-mono text-xs uppercase text-black/50 mb-1">
                  01 // PROJECT
                </p>
                <p className="text-lg font-bold">
                  <span className="relative inline-block">
                    1 Flagship Tool
                    <span className="absolute left-0 -bottom-1 w-full h-[2px] bg-[#FFE600]"></span>
                  </span>{" "}
                  — FileVibe
                </p>
              </div>

              {/* Box 2 */}
              <div className="border-[2px] border-black p-4">
                <p className="font-mono text-xs uppercase text-black/50 mb-1">
                  02 // EDUCATION
                </p>
                <p className="text-lg font-bold">
                  <span className="relative inline-block">
                    BTech CSE
                    <span className="absolute left-0 -bottom-1 w-full h-[2px] bg-[#FFE600]"></span>
                  </span>{" "}
                  — Tech Stack
                </p>
              </div>

              {/* Box 3 */}
              <div className="border-[2px] border-black p-4">
                <p className="font-mono text-xs uppercase text-black/50 mb-1">
                  03 // STATUS
                </p>
                <p className="text-lg font-bold">
                  <span className="relative inline-block">
                    Available
                    <span className="absolute left-0 -bottom-1 w-full h-[2px] bg-[#FFE600]"></span>
                  </span>{" "}
                  for Roles
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
