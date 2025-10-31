"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0f0c29] via-[#302b63] to-[#24243e] text-white">
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-4xl mx-auto"
          >
            {/* Title */}
            <motion.h1
              className="text-5xl md:text-6xl font-bold mb-6 leading-tight"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FFD580] to-[#FF9D47]">
                संसारको दोस्रो
              </span>{" "}
              AI शिक्षक
              <br />
              <span className="gradient-text bg-clip-text text-transparent bg-gradient-to-r from-[#FF9D47] via-[#FF7E5F] to-[#FEB47B]">
                प्रत्यक्ष अडियो-भिडियो व्याख्याको साथ
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-xl text-gray-300 mb-12"
            >
              Learn smarter, faster, and more interactively.
            </motion.p>

            {/* Input + Upload Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              whileHover={{ scale: 1.02 }}
              className="max-w-2xl mx-auto mb-12"
            >
              <Card className="bg-[#1b1838]/80 border border-[#ffb36b]/30 shadow-lg shadow-[#ff9d47]/10 backdrop-blur-md rounded-2xl">
                <CardContent className="p-6">
                  <div className="flex gap-3 mb-4">
                    <Input
                      placeholder="Explain the theory of..."
                      className="flex-1 bg-[#262255] text-white border-none focus:ring-2 focus:ring-[#FF9D47]"
                    />
                    <Button className="bg-gradient-to-r from-[#FF9D47] to-[#D4945C] hover:opacity-90 shadow-md shadow-[#FF9D47]/30">
                      Upload
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Features */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-wrap justify-center gap-6 mb-12"
            >
              {[
                "🎧 Live Audio & Video Explanations",
                "📊 Personalized Performance Guidance",
                "🌐 Multilingual Audio Support",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  variants={itemVariants}
                  whileHover={{ scale: 1.07 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#ffffff0d] border border-[#FF9D47]/30 text-sm md:text-base hover:bg-[#ffffff1a] transition-all duration-300"
                >
                  <span className="w-2 h-2 rounded-full bg-gradient-to-r from-[#FF9D47] to-[#D4945C] animate-pulse"></span>
                  <span>{feature}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Subtext or CTA */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
            >
            </motion.div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
