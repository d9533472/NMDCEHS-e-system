using System;
using Windows.Media.Ocr;
using Windows.Globalization;
class Probe { static void Main() { foreach(var l in OcrEngine.AvailableRecognizerLanguages) Console.WriteLine(l.LanguageTag); } }
