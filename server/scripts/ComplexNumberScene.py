from manim import *

class ComplexNumberScene(Scene):
    def construct(self):
        # Create objects
        complex_plane = NumberPlane().set_opacity(0.5)
        real_axis = complex_plane.get_x_axis().set_color(RED)
        imaginary_axis = complex_plane.get_y_axis().set_color(BLUE)
        complex_number = Dot().move_to(3*RIGHT + 2*UP).set_color(YELLOW)
        
        # Show caption 1
        caption1 = Text("जटिल सङ्ख्याको परिचय", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=3)
        self.play(Create(complex_plane))
        self.wait(0.5)
        
        # Highlight real axis
        self.play(FadeIn(real_axis))
        self.wait(0.5)
        
        # Show caption 2
        self.play(FadeOut(caption1))
        caption2 = Text("वास्तविक र इमेजिनरी भाग", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=4)
        self.play(FadeIn(imaginary_axis))
        self.wait(0.5)
        
        # Display complex number
        self.play(FadeOut(caption2))
        caption3 = Text("जटिल सङ्ख्याको प्रस्तुतिकरण", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=5)
        self.play(Create(complex_number))
        self.wait(0.5)
        self.play(FadeOut(caption3))
        self.wait(2)