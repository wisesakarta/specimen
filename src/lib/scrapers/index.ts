import { Scraper } from "./types";
import { LinetoScraper } from "./lineto";
import { PangramScraper } from "./pangram";
import { GenericScraper } from "./generic";
import { GrilliTypeScraper } from "./grillitype";
import { WTypeScraper } from "./w-type";
import { SuperiorTypeScraper } from "./superiortype";
import { KlimScraper } from "./klim";
import { SwissTypefacesScraper } from "./swisstypefaces";
import { OhnoScraper } from "./ohno";
import { ABCDinamoScraper } from "./abcdinamo";
import { TF205Scraper } from "./205tf";
import { A2TypeScraper } from "./a2-type";
import { CoTypeScraper } from "./cotype";
import { MonoLisaScraper } from "./monolisa";
import { GrotesklyScraper } from "./groteskly";
import { DisplaayScraper } from "./displaay";
import { BrandingWithTypeScraper } from "./brandingwithtype";
import { TypejiScraper } from "./typeji";
import { JulyTypeScraper } from "./julytype";
import { GeneralTypeStudioScraper } from "./generaltypestudio";
import { CommercialTypeScraper } from "./commercialtype";
import { KHTypeScraper } from "./khtype";
import { SharpTypeScraper } from "./sharptype";
import { TypeDepartmentScraper } from "./type-department";
import { NarrowTypeScraper } from "./narrowtype";

export const scrapers: Scraper[] = [
  LinetoScraper,
  PangramScraper,
  GrilliTypeScraper,
  WTypeScraper,
  SuperiorTypeScraper,
  KlimScraper,
  SwissTypefacesScraper,
  OhnoScraper,
  ABCDinamoScraper,
  TF205Scraper,
  A2TypeScraper,
  CoTypeScraper,
  MonoLisaScraper,
  GrotesklyScraper,
  DisplaayScraper,
  BrandingWithTypeScraper,
  TypejiScraper,
  JulyTypeScraper,
  GeneralTypeStudioScraper,
  CommercialTypeScraper,
  KHTypeScraper,
  SharpTypeScraper,
  TypeDepartmentScraper,
  NarrowTypeScraper,
  GenericScraper // Always last as fallback
];

export * from "./types";
