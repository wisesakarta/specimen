import { Scraper } from "./scraper-protocol";
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
import { AbjadTypeScraper } from "./abjadfonts";
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
import { MassDriverScraper } from "./massdriver";
import { CommercialTypeScraper } from "./commercialtype";
import { KHTypeScraper } from "./khtype";
import { SharpTypeScraper } from "./sharptype";
import { TypeDepartmentScraper } from "./type-department";
import { NarrowTypeScraper } from "./narrowtype";
import { ProductionTypeScraper } from "./productiontype";
import { ArillaTypeScraper } from "./arillatype";
import { FormulaTypeScraper } from "./formulatype";
import { TypefacesPizzaScraper } from "./typefaces-pizza";
import { NuformTypeScraper } from "./nuformtype";
import { HanliTypeScraper } from "./hanli";
import { SourceTypeScraper } from "./sourcetype";
import { TypothequeScraper } from "./typotheque";
import { TypeTypeScraper } from "./typetype";
import { IntervalTypeScraper } from "./intervaltype";
import { DueStudioScraper } from "./due-studio";
import { TypejockeysScraper } from "./typejockeys";
import { BlazeTypeScraper } from "./blazetype";
import { FaireTypeScraper } from "./fairetype";
import { DeinwallerScraper } from "./deinwaller";
import { ReneBiederScraper } from "./renebieder";
import { ViktorZumegenScraper } from "./viktorzumegen";
import { OptimoScraper } from "./optimo";
import { NodoTypeScraper } from "./nodotype";
import { TheDesignersFoundryScraper } from "./thedesignersfoundry";
import { SaschaBenteScraper } from "./saschabente";

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
  AbjadTypeScraper,
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
  MassDriverScraper,
  CommercialTypeScraper,
  KHTypeScraper,
  SharpTypeScraper,
  TypeDepartmentScraper,
  NarrowTypeScraper,
  ProductionTypeScraper,
  ArillaTypeScraper,
  FormulaTypeScraper,
  TypefacesPizzaScraper,
  NuformTypeScraper,
  HanliTypeScraper,
  SourceTypeScraper,
  TypothequeScraper,
  TypeTypeScraper,
  IntervalTypeScraper,
  DueStudioScraper,
  TypejockeysScraper,
  BlazeTypeScraper,
  FaireTypeScraper,
  DeinwallerScraper,
  ReneBiederScraper,
  ViktorZumegenScraper,
  OptimoScraper,
  NodoTypeScraper,
  TheDesignersFoundryScraper,
  SaschaBenteScraper,
  GenericScraper // Always last as fallback
];

export * from "./scraper-protocol";
