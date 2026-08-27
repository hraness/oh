import { permanentRedirect } from "next/navigation";

export default function SpecificationV1Redirect() {
  permanentRedirect("/spec");
}
