import { createRoot } from "react-dom/client";
import { CcApp } from "@/components/cc-app";
import "@/styles.css";
import qms from "../public/samples/CO2 cc.txt?raw";
import s1 from "../public/samples/spectrum1.CSV?raw";
import s2 from "../public/samples/spectrum2.CSV?raw";
import s3 from "../public/samples/spectrum3.CSV?raw";
import s4 from "../public/samples/spectrum4.CSV?raw";
import s5 from "../public/samples/spectrum5.CSV?raw";
import s6 from "../public/samples/spectrum6.CSV?raw";

declare global {
  interface Window {
    __CC_SAMPLES?: Record<string, string>;
  }
}

window.__CC_SAMPLES = {
  "CO2 cc.txt": qms,
  "spectrum1.CSV": s1,
  "spectrum2.CSV": s2,
  "spectrum3.CSV": s3,
  "spectrum4.CSV": s4,
  "spectrum5.CSV": s5,
  "spectrum6.CSV": s6,
};

createRoot(document.getElementById("root")!).render(<CcApp />);
