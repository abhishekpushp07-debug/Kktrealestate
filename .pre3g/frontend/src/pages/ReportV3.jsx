import { useParams } from "react-router-dom";
import { ReportSheet } from "@/components/reports3/ReportSheet";

export default function ReportV3() {
  const { key } = useParams();
  return <ReportSheet key={key} reportKey={key} />;
}
